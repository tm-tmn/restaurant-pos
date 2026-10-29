import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { RateLimiter } from '../common/rate-limit';
import { runAsSystem, runAsTenant } from '../common/tenant-context';
import { Branch, Category, DiningTable, Order, OrderItem, Product } from '../entities';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { QueueService } from '../queue/queue.service';
import { CustomerOrderDto } from './public.dto';

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_PENDING_PER_ORDER = 40;
const MAX_ITEM_ROWS_PER_ORDER = 300;
const CUSTOMER = 'customer-qr';

const tooMany = () => new HttpException('ขอใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', HttpStatus.TOO_MANY_REQUESTS);

/**
 * ฝั่งลูกค้า (ไม่ล็อกอิน) — เข้าถึงได้ด้วยโทเค็นสุ่มใน QR เท่านั้น
 * ความปลอดภัย: ราคามาจากฐานข้อมูลเสมอ, จำกัดอัตราต่อ IP และต่อโต๊ะ, จำกัดจำนวนรายการที่ค้างรอยืนยัน,
 * ตอบเฉพาะข้อมูลที่ลูกค้าควรเห็น (ไม่มีข้อมูลการชำระเงิน/พนักงาน/สต็อก)
 */
@Injectable()
export class PublicService {
  private readonly readIp = new RateLimiter(240, 60_000);
  private readonly submitIp = new RateLimiter(30, 10 * 60_000);
  private readonly submitTable = new RateLimiter(15, 10 * 60_000);
  private readonly payTable = new RateLimiter(10, 10 * 60_000);
  private readonly queueIp = new RateLimiter(6, 10 * 60_000);
  private readonly queueBranch = new RateLimiter(120, 10 * 60_000);
  /** ค้นว่าโทเค็น/รหัสร้านเป็นของร้านไหน (ก่อนเข้าบริบทร้าน) */
  private readonly lookupIp = new RateLimiter(600, 60_000);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly queue: QueueService,
  ) {}

  // ---------- แปลงโทเค็นสาธารณะ → ร้าน ----------
  // ลูกค้าไม่ได้ล็อกอิน จึงต้องหาว่าโทเค็นเป็นของร้านไหนก่อน (โหมด system อ่านอย่างเดียว คืนแค่ tenantId)
  // แล้วทำงานที่เหลือทั้งหมดในบริบทของร้านนั้น — RLS กันไม่ให้เห็นข้อมูลร้านอื่นแม้โค้ดส่วนถัดไปจะพลาด

  private async resolveTenant(ip: string, sql: string, params: unknown[], notFound: string): Promise<string> {
    if (!this.lookupIp.take(ip)) throw tooMany();
    const rows: { tenantId: string }[] = await runAsSystem(() => this.ds.query(sql, params));
    if (!rows[0]) throw new NotFoundException(notFound);
    return rows[0].tenantId;
  }

  /** งานของหน้าโต๊ะ (QR ประจำโต๊ะ) */
  async forTable<T>(token: string, ip: string, fn: () => Promise<T>): Promise<T> {
    const msg = 'ไม่พบโต๊ะ — QR อาจหมดอายุ กรุณาเรียกพนักงาน';
    if (!TOKEN_RE.test(token)) throw new NotFoundException(msg);
    const tid = await this.resolveTenant(
      ip,
      `SELECT d."tenantId" FROM dining_tables d JOIN tenants t ON t.id = d."tenantId" WHERE d."qrToken" = $1 AND t.status = 'active'`,
      [token],
      msg,
    );
    return runAsTenant(tid, fn);
  }

  /** งานของบัตรคิว (ลิงก์ที่ลูกค้าได้หลังกดรับคิว) */
  async forQueueTicket<T>(token: string, ip: string, fn: () => Promise<T>): Promise<T> {
    if (!TOKEN_RE.test(token)) throw new NotFoundException('ไม่พบคิว');
    const tid = await this.resolveTenant(
      ip,
      `SELECT q."tenantId" FROM queue_tickets q JOIN tenants t ON t.id = q."tenantId" WHERE q.token = $1 AND t.status = 'active'`,
      [token],
      'ไม่พบคิว',
    );
    return runAsTenant(tid, fn);
  }

  /** งานของหน้าคิวหน้าร้าน (/q/<รหัสร้าน>/<รหัสสาขา>) */
  async forShop<T>(slug: string, ip: string, fn: () => Promise<T>): Promise<T> {
    if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) throw new NotFoundException('ไม่พบสาขา');
    const tid = await this.resolveTenant(ip, `SELECT id AS "tenantId" FROM tenants WHERE slug = $1 AND status = 'active'`, [slug], 'ไม่พบสาขา');
    return runAsTenant(tid, fn);
  }

  private async tableByToken(token: string) {
    if (!TOKEN_RE.test(token)) throw new NotFoundException('ไม่พบโต๊ะ — QR อาจหมดอายุ กรุณาเรียกพนักงาน');
    const table = await this.ds.getRepository(DiningTable).findOneBy({ qrToken: token, active: true });
    const branch = table ? await this.ds.getRepository(Branch).findOneBy({ id: table.branchId }) : null;
    if (!table || !branch) throw new NotFoundException('ไม่พบโต๊ะ — QR อาจหมดอายุ กรุณาเรียกพนักงาน');
    if (!branch.qrOrdering) throw new BadRequestException('ร้านปิดรับออเดอร์ผ่าน QR ชั่วคราว กรุณาสั่งกับพนักงาน');
    return { table, branch };
  }

  private async openOrder(tableId: string) {
    return this.ds.getRepository(Order).findOne({
      where: { tableId, status: 'open' },
      relations: { items: true },
      order: { items: { nameSnapshot: 'ASC' } },
    });
  }

  private billView(o: Order | null) {
    if (!o) return null;
    // ลูกค้าเห็นเฉพาะรายการของบิลตัวเอง (ไม่มีเหตุผลการยกเลิก/ผู้ทำรายการ)
    const items = o.items.map((i) => ({
      name: i.nameSnapshot, qty: i.qty, unitPriceSatang: i.unitPriceSatang, note: i.note,
      status: i.status, kitchenStatus: i.kitchenStatus,
    }));
    return { totalSatang: o.totalSatang, items };
  }

  async tablePage(token: string, ip: string) {
    if (!this.readIp.take(ip)) throw tooMany();
    const { table, branch } = await this.tableByToken(token);
    const [categories, products, order] = await Promise.all([
      this.ds.getRepository(Category).find({ where: { active: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.ds.getRepository(Product).find({ where: { active: true }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.openOrder(table.id),
    ]);
    return {
      branch: { name: branch.name },
      table: { name: table.name },
      requireApproval: branch.qrRequireApproval,
      canPay: this.payments.config().autoConfirm && !!branch.promptpayId,
      menu: {
        categories: categories.map((c) => ({ id: c.id, name: c.name })),
        products: products.map((p) => ({ id: p.id, name: p.name, priceSatang: p.priceSatang, categoryId: p.categoryId })),
      },
      order: this.billView(order),
    };
  }

  async submit(token: string, ip: string, dto: CustomerOrderDto) {
    if (!this.submitIp.take(ip) || !this.submitTable.take(token)) throw tooMany();
    const { table, branch } = await this.tableByToken(token);

    for (let attempt = 0; ; attempt++) {
      try {
        await this.ds.transaction(async (em) => {
          let order = await em.findOne(Order, { where: { tableId: table.id, status: 'open' }, lock: { mode: 'pessimistic_write' } });
          if (!order) {
            const now = new Date();
            order = await em.save(
              em.create(Order, {
                clientId: dto.submissionId, // ใช้รหัสการส่งเป็น clientId ของบิลด้วย — ส่งซ้ำไม่เปิดบิลซ้ำ
                branchId: branch.id,
                tableId: table.id,
                type: 'dine_in',
                status: 'open',
                createdBy: CUSTOMER,
                occurredAt: now,
                orderNo: await this.orders.nextOrderNo(em, branch.id, now),
              }),
            );
          }
          if (await em.existsBy(OrderItem, { orderId: order.id, submissionId: dto.submissionId })) return; // ส่งซ้ำ

          const rows = await em.countBy(OrderItem, { orderId: order.id });
          const pending = await em.countBy(OrderItem, { orderId: order.id, status: 'pending' });
          if (rows + dto.items.length > MAX_ITEM_ROWS_PER_ORDER) throw new BadRequestException('บิลนี้มีรายการมากเกินไป กรุณาเรียกพนักงาน');
          if (pending + dto.items.length > MAX_PENDING_PER_ORDER) throw new BadRequestException('มีรายการรอพนักงานยืนยันอยู่มากแล้ว กรุณารอสักครู่');

          const priced = await this.orders.priceItems(em, dto.items);
          const auto = !branch.qrRequireApproval;
          const now = new Date();
          await em.save(
            priced.map((p) =>
              em.create(OrderItem, {
                ...p,
                orderId: order!.id,
                source: 'customer',
                submissionId: dto.submissionId,
                status: auto ? 'active' : 'pending',
                sentToKitchenAt: auto ? now : null,
              }),
            ),
          );
          if (auto) {
            await this.orders.recalc(em, order);
            await this.orders.cancelPendingIntents(em, order.id);
          }
        });
        break;
      } catch (e) {
        // สองฝ่ายเปิดบิลโต๊ะเดียวกันพร้อมกัน (ลูกค้า/พนักงาน) → ทรานแซกชันที่แพ้ลองใหม่ จะพบบิลที่เปิดไว้แล้ว
        const code = e instanceof QueryFailedError ? (e.driverError as { code?: string })?.code : undefined;
        if (code === '23505' && attempt < 2) continue;
        throw e;
      }
    }
    return { ok: true, requireApproval: branch.qrRequireApproval, order: this.billView(await this.openOrder(table.id)) };
  }

  async startPayment(token: string, ip: string) {
    if (!this.payTable.take(token) || !this.readIp.take(ip)) throw tooMany();
    const { table, branch } = await this.tableByToken(token);
    const order = await this.ds.getRepository(Order).findOneBy({ tableId: table.id, status: 'open' });
    if (!order) throw new BadRequestException('ยังไม่มีรายการในบิล');
    const intent = await this.payments.createForOrder(branch.id, order.id, 0, CUSTOMER);
    return { id: intent.id, qrPayload: intent.qrPayload, amountSatang: intent.amountSatang, expiresAt: intent.expiresAt, status: intent.status };
  }

  async paymentStatus(token: string, ip: string, intentId: string) {
    if (!this.readIp.take(ip)) throw tooMany();
    const { table } = await this.tableByToken(token);
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    // ต้องเป็น intent ของบิลที่เคยเปิดที่โต๊ะนี้ (บิลที่ชำระแล้วก็ยังต้องเห็นสถานะ "paid")
    const row: { orderId: string }[] = await this.ds.query(
      `SELECT p."orderId" FROM payment_intents p JOIN orders o ON o.id = p."orderId" WHERE p.id = $1 AND o."tableId" = $2`,
      [intentId, table.id],
    );
    if (!row[0]) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    const i = await this.payments.getForOrder(row[0].orderId, intentId);
    // ลูกค้าเห็นเฉพาะสถานะ — ไม่เห็นเหตุผลภายใน (review)
    return { status: i.status === 'review' ? 'pending' : i.status, amountSatang: i.amountSatang };
  }

  // ---------- คิว ----------

  private async branchByCode(code: string) {
    if (!/^[A-Z0-9]{2,10}$/.test(code)) throw new NotFoundException('ไม่พบสาขา');
    const b = await this.ds.getRepository(Branch).findOneBy({ code });
    if (!b) throw new NotFoundException('ไม่พบสาขา');
    return b;
  }

  async joinQueue(code: string, ip: string, dto: { partySize: number; name?: string; phone?: string }) {
    if (!this.queueIp.take(ip)) throw tooMany();
    const b = await this.branchByCode(code);
    if (!this.queueBranch.take(b.id)) throw tooMany();
    const t = await this.queue.add(b.id, { partySize: dto.partySize, name: dto.name, phone: dto.phone, source: 'customer' });
    return { token: t.token, code: t.code };
  }

  async queueStatus(token: string, ip: string) {
    if (!this.readIp.take(ip)) throw tooMany();
    if (!TOKEN_RE.test(token)) throw new NotFoundException('ไม่พบคิว');
    return this.queue.statusByToken(token);
  }

  async cancelQueue(token: string, ip: string) {
    if (!this.readIp.take(ip)) throw tooMany();
    if (!TOKEN_RE.test(token)) throw new NotFoundException('ไม่พบคิว');
    await this.queue.cancelByToken(token);
    return { ok: true };
  }

  async queueBoard(code: string, ip: string) {
    if (!this.readIp.take(ip)) throw tooMany();
    const b = await this.branchByCode(code);
    return { branch: b.name, ...(await this.queue.board(b.id)) };
  }
}
