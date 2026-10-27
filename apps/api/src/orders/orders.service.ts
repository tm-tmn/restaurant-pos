import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { calcTotals, settlePayments } from '../common/money';
import { AuditLog, Branch, DiningTable, Order, OrderItem, Payment, Product } from '../entities';
import { ShiftsService } from '../shifts/shifts.service';
import { AddItemsDto, CreateOrderDto, ItemInputDto, PayOrderDto, SyncOrderDto } from './orders.dto';

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(e: unknown, constraintHint?: string) {
  if (!(e instanceof QueryFailedError)) return false;
  const d = e.driverError as { code?: string; constraint?: string } | undefined;
  return d?.code === PG_UNIQUE_VIOLATION && (!constraintHint || d.constraint?.includes(constraintHint) === true);
}

export type SyncResult =
  | { clientId: string; status: 'created' | 'duplicate'; orderNo: string }
  | { clientId: string; status: 'rejected'; error: string };

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  // ---------- helpers ----------

  /** วันที่ตามเวลาไทย (UTC+7) รูปแบบ YYYY-MM-DD */
  private bangkokDay(d: Date) {
    return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  }

  private async nextOrderNo(em: EntityManager, branchId: string, at: Date) {
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

  private audit(em: EntityManager, u: AuthUser, action: string, entity: string, entityId: string, detail?: Record<string, unknown>) {
    return em.save(em.create(AuditLog, { branchId: u.branchId, userId: u.id, action, entity, entityId, detail: detail ?? null }));
  }

  /** ล็อกแถวออเดอร์ (ไม่ join เพื่อให้ FOR UPDATE ใช้ได้) แล้วค่อยโหลดรายการ */
  private async lockOrder(em: EntityManager, id: string, branchId: string) {
    const order = await em.findOne(Order, { where: { id, branchId }, lock: { mode: 'pessimistic_write' } });
    if (!order) throw new NotFoundException('ไม่พบออเดอร์');
    return order;
  }

  private async recalc(em: EntityManager, order: Order) {
    const items = await em.find(OrderItem, { where: { orderId: order.id, status: 'active' } });
    const t = calcTotals(items, order.discountSatang);
    order.subtotalSatang = t.subtotal;
    order.totalSatang = t.total;
    await em.save(order);
  }

  private async priceItems(em: EntityManager, inputs: ItemInputDto[]) {
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
    });
    return this.get(u, id);
  }

  async voidOrder(u: AuthUser, id: string, reason: string) {
    await this.ds.transaction(async (em) => {
      const order = await this.lockOrder(em, id, u.branchId);
      if (order.status !== 'open') throw new BadRequestException('ยกเลิกได้เฉพาะบิลที่ยังเปิดอยู่');
      order.status = 'void';
      await em.save(order);
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
      if (order.status !== 'open') throw new BadRequestException('บิลนี้ชำระหรือยกเลิกไปแล้ว');
      const items = await em.find(OrderItem, { where: { orderId: order.id, status: 'active' } });
      if (items.length === 0) throw new BadRequestException('บิลไม่มีรายการสินค้า');

      const totals = calcTotals(items, dto.discountSatang ?? 0);
      const settled = settlePayments(totals.total, dto.payments);
      const now = new Date();

      await em.save(settled.map((p) => em.create(Payment, { ...p, reference: p.reference ?? null, orderId: order.id })));
      order.subtotalSatang = totals.subtotal;
      order.discountSatang = totals.discount;
      order.totalSatang = totals.total;
      order.status = 'paid';
      order.paidAt = now;
      order.shiftId = (await this.shifts.findForTime(em, u.branchId, now))?.id ?? null;
      await em.save(order);
      if (totals.discount > 0) {
        await this.audit(em, u, 'order.discount', 'order', order.id, { orderNo: order.orderNo, discountSatang: totals.discount });
      }
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
          }),
        ),
      );
      await em.save(settled.map((p) => em.create(Payment, { ...p, reference: p.reference ?? null, orderId: order.id })));

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
