import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { calcTotals } from '../common/money';
import { Branch, OrderItem, PaymentIntent } from '../entities';
import { OrdersService } from '../orders/orders.service';
import { promptPayPayload } from './promptpay';

/** none = ยืนยันเองด้วยมือ (ค่าเริ่มต้น) · webhook = รับแจ้งเงินเข้าจาก payment gateway · mock = จำลองสำหรับพัฒนา/สาธิต */
export type PaymentProvider = 'none' | 'webhook' | 'mock';

export const INTENT_TTL_MS = 15 * 60_000;

export interface IntentView {
  id: string;
  orderId: string;
  amountSatang: number;
  discountSatang: number;
  status: PaymentIntent['status'];
  qrPayload: string;
  expiresAt: Date;
  paidAt: Date | null;
  note: string | null;
}

export interface ConfirmInput {
  intentId: string;
  txnId: string;
  amountSatang: number;
}
export type ConfirmResult = { result: 'paid' | 'duplicate' } | { result: 'review'; reason: string };

export function paymentProvider(): PaymentProvider {
  const v = (process.env.PAYMENT_PROVIDER ?? 'none').toLowerCase();
  if (v === 'mock' && process.env.NODE_ENV === 'production') {
    throw new Error('PAYMENT_PROVIDER=mock ใช้กับ production ไม่ได้');
  }
  if (v === 'webhook' || v === 'mock') return v;
  return 'none';
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly orders: OrdersService,
  ) {}

  config() {
    const provider = paymentProvider();
    return { provider, autoConfirm: provider !== 'none' };
  }

  private view(i: PaymentIntent): IntentView {
    // หมดอายุแบบ lazy: ไม่ต้องมีงานเบื้องหลังคอยปิด
    const status = i.status === 'pending' && i.expiresAt.getTime() < Date.now() ? 'expired' : i.status;
    return {
      id: i.id,
      orderId: i.orderId,
      amountSatang: i.amountSatang,
      discountSatang: i.discountSatang,
      status,
      qrPayload: i.qrPayload,
      expiresAt: i.expiresAt,
      paidAt: i.paidAt,
      note: i.note,
    };
  }

  /**
   * สร้าง (หรือใช้ซ้ำ) QR สำหรับจ่ายทั้งบิล — ยอดคำนวณจากบิลในฐานข้อมูลเสมอ ไม่เชื่อยอดจากผู้เรียก
   * กดซ้ำด้วยยอดเดิมจะได้ QR เดิม ไม่สร้างกองซ้อน
   */
  async createForOrder(branchId: string, orderId: string, discountSatang: number, createdBy: string): Promise<IntentView> {
    if (!this.config().autoConfirm) throw new BadRequestException('ร้านยังไม่ได้เปิดใช้การยืนยันการชำระอัตโนมัติ');
    const intent = await this.ds.transaction(async (em) => {
      const order = await this.orders.lockOrder(em, orderId, branchId);
      if (order.status !== 'open') throw new BadRequestException('บิลนี้ชำระหรือยกเลิกไปแล้ว');
      if (await em.existsBy(OrderItem, { orderId, status: 'pending' })) {
        throw new BadRequestException('มีรายการที่ลูกค้าสั่งผ่าน QR รอพนักงานยืนยันอยู่');
      }
      const items = await em.find(OrderItem, { where: { orderId, status: 'active' } });
      if (items.length === 0) throw new BadRequestException('บิลไม่มีรายการสินค้า');
      const totals = calcTotals(items, discountSatang);
      const branch = await em.findOneByOrFail(Branch, { id: branchId });
      if (!branch.promptpayId) throw new BadRequestException('ร้านยังไม่ได้ตั้งค่า PromptPay ID');

      const existing = await em.find(PaymentIntent, { where: { orderId, status: 'pending' }, lock: { mode: 'pessimistic_write' } });
      const now = Date.now();
      const same = existing.find((e) => e.amountSatang === totals.total && e.discountSatang === totals.discount && e.expiresAt.getTime() > now + 60_000);
      for (const e of existing) if (e !== same) await em.update(PaymentIntent, { id: e.id }, { status: 'cancelled', note: 'สร้าง QR ใหม่แทน' });
      if (same) return same;
      return em.save(
        em.create(PaymentIntent, {
          branchId,
          orderId,
          amountSatang: totals.total,
          discountSatang: totals.discount,
          status: 'pending',
          qrPayload: promptPayPayload(branch.promptpayId, totals.total),
          expiresAt: new Date(now + INTENT_TTL_MS),
          createdBy,
        }),
      );
    });
    return this.view(intent);
  }

  async get(branchId: string, id: string): Promise<IntentView> {
    const i = await this.ds.getRepository(PaymentIntent).findOneBy({ id, branchId });
    if (!i) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    return this.view(i);
  }

  /** ดูสถานะ QR ของลูกค้าที่โต๊ะ — ต้องเป็น intent ของบิลที่เปิดอยู่ของโต๊ะนั้นเท่านั้น */
  async getForOrder(orderId: string, id: string): Promise<IntentView> {
    const i = await this.ds.getRepository(PaymentIntent).findOneBy({ id, orderId });
    if (!i) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    return this.view(i);
  }

  async cancel(branchId: string, id: string) {
    const res = await this.ds.getRepository(PaymentIntent).update({ id, branchId, status: 'pending' }, { status: 'cancelled', note: 'ยกเลิกโดยพนักงาน' });
    if (!res.affected) throw new BadRequestException('ยกเลิกได้เฉพาะ QR ที่ยังรอชำระ');
    return this.get(branchId, id);
  }

  listReview(branchId: string) {
    return this.ds.getRepository(PaymentIntent).find({ where: { branchId, status: 'review' }, order: { createdAt: 'DESC' }, take: 100 });
  }

  /**
   * เงินเข้า (ยืนยันแล้วจากผู้ให้บริการ) → ปิดบิลอัตโนมัติ ถ้าทุกอย่างตรงกันเท่านั้น:
   *  ยอดที่โอน = ยอดใน QR, บิลยังเปิดอยู่, ยอดบิลยังเท่าตอนสร้าง QR
   * ถ้าไม่ตรง ห้ามเดาปิดบิล — ย้ายเป็น "review" พร้อมบันทึก audit ให้ผู้จัดการตรวจ/คืนเงิน
   * ปลอดภัยต่อการยิงซ้ำ (idempotent ด้วย txnId)
   */
  async confirm(input: ConfirmInput): Promise<ConfirmResult> {
    const pre = await this.ds.getRepository(PaymentIntent).findOneBy({ id: input.intentId });
    if (!pre) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    try {
      return await this.ds.transaction((em) => this.confirmTx(em, pre, input));
    } catch (e) {
      // txnId ซ้ำกับอีกรายการ (unique index) = ผู้ให้บริการส่งธุรกรรมเดิมมาอีกรอบ
      if ((e as { driverError?: { code?: string } })?.driverError?.code === '23505') throw new ConflictException('เลขธุรกรรมนี้ถูกใช้แล้ว');
      throw e;
    }
  }

  private async confirmTx(em: EntityManager, pre: PaymentIntent, input: ConfirmInput): Promise<ConfirmResult> {
    // ล็อกบิลก่อนเสมอ แล้วค่อยล็อก intent — ลำดับเดียวกับฝั่งพนักงานกดชำระ กัน deadlock
    const order = await this.orders.lockOrder(em, pre.orderId, pre.branchId);
    const intent = await em.findOneOrFail(PaymentIntent, { where: { id: pre.id }, lock: { mode: 'pessimistic_write' } });
    const actor = { id: null, branchId: pre.branchId };

    if (intent.txnId === input.txnId && (intent.status === 'paid' || intent.status === 'review')) return { result: 'duplicate' };
    if (await em.createQueryBuilder(PaymentIntent, 'p').where('p.txnId = :t AND p.id <> :id', { t: input.txnId, id: intent.id }).getExists()) {
      throw new ConflictException('เลขธุรกรรมนี้ถูกใช้แล้ว');
    }

    let reason: string | null = null;
    if (intent.status === 'paid') {
      // QR ใบเดียวถูกจ่ายซ้ำด้วยธุรกรรมอื่น = เงินเข้าเกิน ต้องคืน
      await this.orders.audit(em, actor, 'payment.review', 'payment_intent', intent.id, {
        orderNo: order.orderNo, txnId: input.txnId, amountSatang: input.amountSatang, reason: 'QR ใบนี้ชำระสำเร็จไปแล้ว — ได้รับเงินซ้ำ ต้องคืนเงิน',
      });
      return { result: 'review', reason: 'ได้รับเงินซ้ำ' };
    }
    if (input.amountSatang !== intent.amountSatang) reason = `ยอดที่โอน (${input.amountSatang / 100} บาท) ไม่ตรงกับ QR (${intent.amountSatang / 100} บาท)`;
    else if (intent.status === 'cancelled') reason = `QR ถูกยกเลิกแล้ว${intent.note ? ` (${intent.note})` : ''} แต่ลูกค้าโอนเงินเข้ามา`;
    else if (order.status !== 'open') reason = 'บิลถูกชำระหรือยกเลิกไปแล้ว แต่ลูกค้าโอนเงินเข้ามา';
    else {
      const pending = await em.existsBy(OrderItem, { orderId: order.id, status: 'pending' });
      const items = await em.find(OrderItem, { where: { orderId: order.id, status: 'active' } });
      const total = items.length ? calcTotals(items, intent.discountSatang).total : -1;
      if (pending) reason = 'มีรายการสั่งใหม่รอยืนยันในบิล';
      else if (total !== intent.amountSatang) reason = 'ยอดบิลเปลี่ยนไปจากตอนสร้าง QR';
    }

    const now = new Date();
    if (reason) {
      intent.status = 'review';
      intent.txnId = input.txnId;
      intent.paidAmountSatang = input.amountSatang;
      intent.paidAt = now;
      intent.note = reason;
      await em.save(intent);
      await this.orders.audit(em, actor, 'payment.review', 'payment_intent', intent.id, {
        orderNo: order.orderNo, txnId: input.txnId, amountSatang: input.amountSatang, reason,
      });
      return { result: 'review', reason };
    }

    await this.orders.payCore(
      em,
      order,
      actor,
      { discountSatang: intent.discountSatang, payments: [{ method: 'promptpay', amountSatang: intent.amountSatang, reference: input.txnId }] },
      now,
    );
    intent.status = 'paid';
    intent.txnId = input.txnId;
    intent.paidAmountSatang = input.amountSatang;
    intent.paidAt = now;
    intent.note = null;
    await em.save(intent);
    await this.orders.audit(em, actor, 'payment.auto_confirm', 'payment_intent', intent.id, {
      orderNo: order.orderNo, txnId: input.txnId, amountSatang: input.amountSatang,
    });
    return { result: 'paid' };
  }

  /** โหมดจำลอง (พัฒนา/สาธิต): ทำเหมือนผู้ให้บริการแจ้งว่าเงินเข้าแล้ว — ผ่านเส้นทางตรวจสอบเดียวกับของจริง */
  async simulatePaid(branchId: string, id: string) {
    if (paymentProvider() !== 'mock') throw new ServiceUnavailableException('ใช้ได้เฉพาะโหมดจำลอง (PAYMENT_PROVIDER=mock)');
    const i = await this.ds.getRepository(PaymentIntent).findOneBy({ id, branchId });
    if (!i) throw new NotFoundException('ไม่พบรายการชำระเงิน');
    return this.confirm({ intentId: id, txnId: `MOCK-${randomUUID()}`, amountSatang: i.amountSatang });
  }
}
