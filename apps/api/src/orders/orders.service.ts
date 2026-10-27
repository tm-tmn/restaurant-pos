import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { calcTotals, settlePayments } from '../common/money';
import { AuditLog, Branch, DiningTable, Order, OrderItem, Payment, PaymentIntent, Product } from '../entities';
import { InventoryService } from '../inventory/inventory.service';
import { ShiftsService } from '../shifts/shifts.service';
import { AddItemsDto, CreateOrderDto, ItemInputDto, PayOrderDto, SyncOrderDto } from './orders.dto';

const PG_UNIQUE_VIOLATION = '23505';
/** บิลออฟไลน์ที่ส่งเข้ามาช้ากว่านี้จะถูกปฏิเสธ (ไปอยู่ในกอง "ต้องตรวจสอบ" ที่เครื่อง) */
const MAX_OFFLINE_AGE_MS = 7 * 24 * 3600_000;

function isUniqueViolation(e: unknown, constraintHint?: string) {
  if (!(e instanceof QueryFailedError)) return false;
  const d = e.driverError as { code?: string; constraint?: string } | undefined;
  return d?.code === PG_UNIQUE_VIOLATION && (!constraintHint || d.constraint?.includes(constraintHint) === true);
}

/** ผู้กระทำ: พนักงาน หรือ null เมื่อระบบทำเอง (เช่น ปิดบิลอัตโนมัติจากเงินเข้า) */
export interface Actor {
  id: string | null;
  branchId: string;
}

export type SyncResult =
  | { clientId: string; status: 'created' | 'duplicate'; orderNo: string }
  | { clientId: string; status: 'rejected'; error: string };

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly shifts: ShiftsService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- helpers ----------

  /** วันที่ตามเวลาไทย (UTC+7) รูปแบบ YYYY-MM-DD */
  private bangkokDay(d: Date) {
    return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  }

  async nextOrderNo(em: EntityManager, branchId: string, at: Date) {
    const branch = await em.findOneByOrFail(Branch, { id: branchId });
    const day = this.bangkokDay(at);
    const rows: { n: number }[] = await em.query(
      `INSERT INTO daily_counters ("branchId", day, n) VALUES ($1, $2, 1)
       ON CONFLICT ("branchId", day) DO UPDATE SET n = daily_counters.n + 1
       RETURNING n`,
      [branchId, day],
    );
    return `${branch.code}-${day.replace(/-/g, '')}-${String(rows[0].n).padStart(4, '0')}`;
  }

  audit(em: EntityManager, u: Actor, action: string, entity: string, entityId: string, detail?: Record<string, unknown>) {
    return em.save(em.create(AuditLog, { branchId: u.branchId, userId: u.id, action, entity, entityId, detail: detail ?? null }));
  }

  /** บิลเปลี่ยน (เพิ่ม/ยกเลิกรายการ) → QR ที่ยังรอจ่ายอยู่ใช้ไม่ได้อีก เพราะยอดไม่ตรงกับบิลแล้ว */
  async cancelPendingIntents(em: EntityManager, orderId: string) {
    await em.update(PaymentIntent, { orderId, status: 'pending' }, { status: 'cancelled', note: 'บิลมีการเปลี่ยนแปลง' });
  }

  /** ล็อกแถวออเดอร์ (ไม่ join เพื่อให้ FOR UPDATE ใช้ได้) แล้วค่อยโหลดรายการ */
  async lockOrder(em: EntityManager, id: string, branchId: string) {
    const order = await em.findOne(Order, { where: { id, branchId }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException('ไม่พบออเดอร์');
    return order;
  }

  async recalc(em: EntityManager, order: Order) {
    const items = await em.find(OrderItem, { where: { orderId: order.id, status: 'active' } });
    const t = calcTotals(items, order.discountSatang);
    order.subtotalSatang = t.subtotal;
    order.totalSatang = t.total;
    await em.save(order);
  }

  async priceItems(em: EntityManager, inputs: ItemInputDto[]) {
    const ids = [...new Set(inputs.map((i) => i.productId))];
    const products = await em.find(Product, { where: { id: In(ids), active: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    return inputs.map((i) => {
      const p = byId.get(i.productId);
      if (!p) throw new BadRequestException('มีสินค้าที่ไม่พบหรือปิดการขายแล้ว');
      return { productId: p.id, nameSnapshot: p.name, unitPriceSatang: p.priceSatang, qty: i.qty, note: i.note ?? null };
    });
  }

  // ---------- queries ----------

  async get(u: AuthUser, id: string) {
    const o = await this.ds.getRepository(Order).findOne({
      where: { id, branchId: u.branchId },
      relations: { items: true, payments: true },
      order: { items: { nameSnapshot: 'ASC' } },
    });
    if (!o) throw new NotFoundException('ไม่พบออเดอร์');
    return o;
  }

  list(u: AuthUser, status: 'open' | 'paid' | 'void') {
    return this.ds.getRepository(Order).find({
      where: { branchId: u.branchId, status },
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  // ---------- table / open-bill flow (ต้องออนไลน์) ----------

  async create(u: AuthUser, dto: CreateOrderDto) {
    try {
      const id = await this.ds.transaction(async (em) => {
        const existing = await em.findOneBy(Order, { branchId: u.branchId, clientId: dto.clientId });
        if (existing) return existing.id; // ส่งซ้ำ → คืนบิลเดิม

        if (dto.type === 'dine_in') {
          if (!dto.tableId) throw new BadRequestException('ออเดอร์ทานที่ร้านต้องเลือกโต๊ะ');
          const t = await em.findOneBy(DiningTable, { id: dto.tableId, branchId: u.branchId, active: true });
          if (!t) throw new BadRequestException('ไม่พบโต๊ะ');
        }
        const priced = await this.priceItems(em, dto.items);
        const now = new Date();
        const order = em.create(Order, {
          clientId: dto.clientId,
          branchId: u.branchId,
          tableId: dto.type === 'dine_in' ? dto.tableId! : null,
          type: dto.type,
          status: 'open',
          note: dto.note ?? null,
          createdBy: u.id,
          occurredAt: now,
          orderNo: await this.nextOrderNo(em, u.branchId, now),
        });
        const saved = await em.save(order);
        await em.save(priced.map((p) => em.create(OrderItem, { ...p, orderId: saved.id, sentToKitchenAt: now })));
        await this.recalc(em, saved);
        return saved.id;
      });
      return this.get(u, id);
    } catch (e) {
      if (isUniqueViolation(e, 'uq_open_order_per_table')) throw new ConflictException('โต๊ะนี้มีบิลเปิดอยู่แล้ว ให้เพิ่มรายการเข้าบิลเดิม');
      if (isUniqueViolation(e)) {
        const dup = await this.ds.getRepository(Order).findOneBy({ branchId: u.branchId, clientId: dto.clientId });
        if (dup) return this.get(u, dup.id);
      }
      throw e;
    }
  }

  async addItems(u: AuthUser, id: string, dto: AddItemsDto) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('บิลนี้ปิดแล้ว');
      const priced = await this.priceItems(em, dto.items);
      const now = new Date();
      await em.save(priced.map((p) => em.create(OrderItem, { ...p, orderId: order.id, sentToKitchenAt: now })));
      await this.recalc(em, order);
      await this.cancelPendingIntents(em, order.id);
    });
    return this.get(u, id);
  }

  async voidItem(u: AuthUser, id: string, itemId: string, reason: string) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('ยกเลิกรายการได้เฉพาะบิลที่ยังเปิดอยู่');
      const item = await em.findOneBy(OrderItem, { id: itemId, orderId: order.id });
      if (!item) throw new NotFoundException('ไม่พบรายการ');
      if (item.status === 'void') return;
      const wasPending = item.status === 'pending';
      item.status = 'void';
      item.voidReason = reason;
      await em.save(item);
      await this.audit(em, u, 'order_item.void', 'order_item', item.id, {
        orderNo: order.orderNo,
        name: item.nameSnapshot,
        qty: item.qty,
        unitPriceSatang: item.unitPriceSatang,
        reason,
      });
      await this.recalc(em, order);
      if (!wasPending) await this.cancelPendingIntents(em, order.id);
    });
    return this.get(u, id);
  }

  async voidOrder(u: AuthUser, id: string, reason: string) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('ยกเลิกได้เฉพาะบิลที่ยังเปิดอยู่');
      order.status = 'void';
      await em.save(order);
      // รายการที่ลูกค้าสั่งผ่าน QR และยังไม่ได้ยืนยัน ปิดไปพร้อมบิล
      await em.update(OrderItem, { orderId: order.id, status: 'pending' }, { status: 'void', voidReason: 'ยกเลิกทั้งบิล' });
      await this.cancelPendingIntents(em, order.id);
      await this.audit(em, u, 'order.void', 'order', order.id, {
        orderNo: order.orderNo,
        totalSatang: order.totalSatang,
        reason,
      });
    });
    return this.get(u, id);
  }

  async pay(u: AuthUser, id: string, dto: PayOrderDto) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      await this.payCore(em, order, u, dto);
    });
    return this.get(u, id);
  }

  /**
   * ปิดบิล (ล็อกออเดอร์ไว้แล้วโดยผู้เรียก) — ใช้ร่วมกันระหว่างพนักงานกดชำระ และระบบปิดบิลอัตโนมัติเมื่อเงิน PromptPay เข้า
   * ชำระ + หักวัตถุดิบ + ปิด QR ที่ค้าง อยู่ในทรานแซกชันเดียวกัน
   */
  async payCore(em: EntityManager, order: Order, actor: Actor, dto: PayOrderDto, now = new Date()) {
    if (order.status !== 'open') throw new BadRequestException('บิลนี้ชำระหรือยกเลิกไปแล้ว');
    if (await em.existsBy(OrderItem, { orderId: order.id, status: 'pending' })) {
      throw new BadRequestException('มีรายการที่ลูกค้าสั่งผ่าน QR รอยืนยันอยู่ — ยืนยันหรือปฏิเสธก่อนชำระ');
    }
    const items = await em.find(OrderItem, { where: { orderId: order.id, status: 'active' } });
    if (items.length === 0) throw new BadRequestException('บิลไม่มีรายการสินค้า');

    const totals = calcTotals(items, dto.discountSatang ?? 0);
    const settled = settlePayments(totals.total, dto.payments);

    await em.save(settled.map((p) => em.create(Payment, { ...p, reference: p.reference ?? null, orderId: order.id })));
    order.subtotalSatang = totals.subtotal;
    order.discountSatang = totals.discount;
    order.totalSatang = totals.total;
    order.status = 'paid';
    order.paidAt = now;
    order.shiftId = (await this.shifts.findForTime(em, actor.branchId, now))?.id ?? null;
    await em.save(order);
    // หักวัตถุดิบตามสูตร ในทรานแซกชันเดียวกับการชำระ (สำเร็จทั้งคู่หรือไม่เกิดทั้งคู่)
    await this.inventory.deductForSale(em, actor.branchId, order.id, items);
    await em.update(PaymentIntent, { orderId: order.id, status: 'pending' }, { status: 'cancelled', note: 'บิลชำระแล้ว' });
    if (totals.discount > 0) {
      await this.audit(em, actor, 'order.discount', 'order', order.id, { orderNo: order.orderNo, discountSatang: totals.discount });
    }
    return { order, totals };
  }

  // ---------- รายการที่ลูกค้าสั่งผ่าน QR (รอพนักงานยืนยัน) ----------

  async listPending(u: AuthUser) {
    const rows: {
      orderId: string; orderNo: string; tableName: string | null; itemId: string; name: string; qty: number;
      unitPriceSatang: number; note: string | null; createdAt: string;
    }[] = await this.ds.query(
      `SELECT o.id AS "orderId", o."orderNo", t.name AS "tableName", i.id AS "itemId", i."nameSnapshot" AS name, i.qty,
              i."unitPriceSatang", i.note, o."createdAt"
         FROM order_items i
         JOIN orders o ON o.id = i."orderId"
         LEFT JOIN dining_tables t ON t.id = o."tableId"
        WHERE o."branchId" = $1 AND o.status = 'open' AND i.status = 'pending'
        ORDER BY o."createdAt", i."nameSnapshot"`,
      [u.branchId],
    );
    const byOrder = new Map<string, { orderId: string; orderNo: string; tableName: string | null; items: typeof rows }>();
    for (const r of rows) {
      const g = byOrder.get(r.orderId) ?? { orderId: r.orderId, orderNo: r.orderNo, tableName: r.tableName, items: [] };
      g.items.push(r);
      byOrder.set(r.orderId, g);
    }
    return [...byOrder.values()];
  }

  /** ยืนยันรายการที่ลูกค้าสั่ง (ทั้งหมด หรือเฉพาะ itemIds) → เข้าบิลและส่งเข้าครัว */
  async approvePending(u: AuthUser, id: string, itemIds?: string[]) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('บิลนี้ปิดแล้ว');
      const where = { orderId: order.id, status: 'pending' as const, ...(itemIds?.length ? { id: In(itemIds) } : {}) };
      const now = new Date();
      const res = await em.update(OrderItem, where, { status: 'active', sentToKitchenAt: now, kitchenStatus: 'new' });
      if (!res.affected) return;
      await this.recalc(em, order);
      await this.cancelPendingIntents(em, order.id);
      await this.audit(em, u, 'order.qr_approve', 'order', order.id, { orderNo: order.orderNo, items: res.affected });
    });
    return this.get(u, id);
  }

  async rejectPending(u: AuthUser, id: string, reason: string, itemIds?: string[]) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('บิลนี้ปิดแล้ว');
      const where = { orderId: order.id, status: 'pending' as const, ...(itemIds?.length ? { id: In(itemIds) } : {}) };
      const res = await em.update(OrderItem, where, { status: 'void', voidReason: `ปฏิเสธรายการที่ลูกค้าสั่งเอง: ${reason}` });
      if (!res.affected) return;
      await this.audit(em, u, 'order.qr_reject', 'order', order.id, { orderNo: order.orderNo, items: res.affected, reason });
    });
    return this.get(u, id);
  }

  // ---------- offline sync ----------

  /**
   * รับออเดอร์ที่ขายตอน offline เป็นชุด — ปลอดภัยต่อการส่งซ้ำ (idempotent ด้วย branchId+clientId)
   * ผลลัพธ์แยกรายบิล: created | duplicate | rejected เพื่อให้เครื่อง POS ลบออกจากคิวได้ถูกบิล
   */
  async sync(u: AuthUser, orders: SyncOrderDto[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const dto of orders) {
      try {
        results.push(await this.syncOne(u, dto));
      } catch (e) {
        if (isUniqueViolation(e)) {
          const dup = await this.ds.getRepository(Order).findOneBy({ branchId: u.branchId, clientId: dto.clientId });
          if (dup) {
            results.push({ clientId: dto.clientId, status: 'duplicate', orderNo: dup.orderNo });
            continue;
          }
        }
        const message = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
        results.push({ clientId: dto.clientId, status: 'rejected', error: message });
      }
    }
    return results;
  }

  private syncOne(u: AuthUser, dto: SyncOrderDto): Promise<SyncResult> {
    return this.ds.transaction(async (em) => {
      const existing = await em.findOneBy(Order, { branchId: u.branchId, clientId: dto.clientId });
      if (existing) return { clientId: dto.clientId, status: 'duplicate', orderNo: existing.orderNo };

      const occurredAt = new Date(dto.occurredAt);
      const now = new Date();
      if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('occurredAt ไม่ถูกต้อง');
      // กันบิลย้อนหลังผิดปกติ (นาฬิกาเครื่องผิด หรือแก้เวลาเพื่อลงบิลในวันที่ปิดยอดไปแล้ว)
      if (now.getTime() - occurredAt.getTime() > MAX_OFFLINE_AGE_MS) {
        throw new BadRequestException('บิลเก่าเกิน 7 วัน — ตรวจสอบเวลาเครื่อง POS แล้วให้ผู้จัดการบันทึกด้วยตนเอง');
      }
      // นาฬิกาเครื่องเดินเร็วเกินไป → ใช้เวลาเซิร์ฟเวอร์แทน (กันบิลล่วงหน้า)
      const at = occurredAt.getTime() > now.getTime() + 5 * 60_000 ? now : occurredAt;

      // กฎเดียวกับช่องทางออนไลน์: ส่วนลดต้องให้ผู้จัดการขึ้นไป (กัน cashier ข้ามกฎผ่านการซิงค์)
      if ((dto.discountSatang ?? 0) > 0 && u.role === 'cashier') {
        throw new BadRequestException('ส่วนลดต้องให้ผู้จัดการดำเนินการ');
      }
      const totals = calcTotals(dto.items, dto.discountSatang ?? 0);
      const settled = settlePayments(totals.total, dto.payments);

      // ราคา snapshot จากเครื่อง: ลูกค้าจ่ายตามนั้นจริง แต่บันทึก audit ถ้าต่างจากราคาปัจจุบัน
      const productIds = [...new Set(dto.items.map((i) => i.productId).filter((x): x is string => !!x))];
      const products = productIds.length ? await em.find(Product, { where: { id: In(productIds) } }) : [];
      const priceById = new Map(products.map((p) => [p.id, p.priceSatang]));

      const order = await em.save(
        em.create(Order, {
          clientId: dto.clientId,
          branchId: u.branchId,
          tableId: null,
          type: dto.type,
          status: 'paid',
          note: dto.note ?? null,
          subtotalSatang: totals.subtotal,
          discountSatang: totals.discount,
          totalSatang: totals.total,
          createdBy: u.id,
          occurredAt: at,
          paidAt: at,
          orderNo: await this.nextOrderNo(em, u.branchId, at),
          shiftId: (await this.shifts.findForTime(em, u.branchId, at))?.id ?? null,
        }),
      );
      await em.save(
        dto.items.map((i) =>
          em.create(OrderItem, {
            orderId: order.id,
            productId: i.productId && priceById.has(i.productId) ? i.productId : null,
            nameSnapshot: i.name,
            unitPriceSatang: i.unitPriceSatang,
            qty: i.qty,
            note: i.note ?? null,
            // ขายหน้าร้านแล้วจ่ายทันที (ออฟไลน์) — ไม่ผ่านจอครัว
            kitchenStatus: 'served',
          }),
        ),
      );
      await em.save(settled.map((p) => em.create(Payment, { ...p, reference: p.reference ?? null, orderId: order.id })));
      await this.inventory.deductForSale(
        em,
        u.branchId,
        order.id,
        dto.items.map((i) => ({ productId: i.productId && priceById.has(i.productId) ? i.productId : null, qty: i.qty })),
      );

      const mismatches = dto.items.filter((i) => i.productId && priceById.has(i.productId) && priceById.get(i.productId) !== i.unitPriceSatang);
      if (mismatches.length) {
        await this.audit(em, u, 'sync.price_mismatch', 'order', order.id, {
          orderNo: order.orderNo,
          items: mismatches.map((m) => ({ name: m.name, soldSatang: m.unitPriceSatang, currentSatang: priceById.get(m.productId!) })),
        });
      }
      if (totals.discount > 0) {
        await this.audit(em, u, 'order.discount', 'order', order.id, { orderNo: order.orderNo, discountSatang: totals.discount, offline: true });
      }
      return { clientId: dto.clientId, status: 'created', orderNo: order.orderNo };
    });
  }
}
