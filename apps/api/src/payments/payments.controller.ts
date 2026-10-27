import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Public, Roles } from '../auth/auth.types';
import { MAX_BILL_SATANG } from '../common/money';
import { PaymentsService, paymentProvider } from './payments.service';
import { verifyWebhook } from './webhook-signature';

class CreateIntentDto {
  @IsOptional() @IsInt() @Min(0) @Max(MAX_BILL_SATANG) discountSatang?: number;
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments/config')
  config() {
    return this.payments.config();
  }

  @Post('orders/:id/payment-intents')
  create(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateIntentDto) {
    if ((dto.discountSatang ?? 0) > 0 && u.role === 'cashier') throw new ForbiddenException('ส่วนลดต้องให้ผู้จัดการดำเนินการ');
    return this.payments.createForOrder(u.branchId, id, dto.discountSatang ?? 0, u.id);
  }

  @Get('payment-intents/:id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.get(u.branchId, id);
  }

  @Post('payment-intents/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.cancel(u.branchId, id);
  }

  /** รายการที่เงินเข้าแต่จับคู่บิลไม่ได้ — ต้องให้ผู้จัดการตรวจ/คืนเงิน */
  @Roles('manager')
  @Get('payment-intents')
  review(@CurrentUser() u: AuthUser) {
    return this.payments.listReview(u.branchId);
  }

  @Roles('manager')
  @Post('payment-intents/:id/simulate-paid')
  @HttpCode(200)
  simulate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.simulatePaid(u.branchId, id);
  }

  /**
   * Webhook รับแจ้งเงินเข้า — สัญญากลางที่ adapter ของแต่ละผู้ให้บริการแปลงมาเป็นรูปแบบนี้:
   *   headers: x-timestamp (ms), x-signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
   *   body:    { intentId, txnId, amountSatang, status: 'paid' }
   */
  @Public()
  @Post('payments/webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Body() body: Record<string, unknown>) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
    if (paymentProvider() !== 'webhook' || !secret) throw new ServiceUnavailableException('ยังไม่ได้เปิดใช้ webhook การชำระเงิน');
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!verifyWebhook(secret, req.header('x-timestamp'), req.header('x-signature'), raw)) throw new UnauthorizedException('ลายเซ็นไม่ถูกต้อง');

    const { intentId, txnId, amountSatang, status } = body;
    if (status !== 'paid') return { result: 'ignored' };
    if (
      typeof intentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(intentId) ||
      typeof txnId !== 'string' || txnId.length < 1 || txnId.length > 100 ||
      typeof amountSatang !== 'number' || !Number.isInteger(amountSatang) || amountSatang < 1 || amountSatang > MAX_BILL_SATANG
    ) {
      throw new BadRequestException('ข้อมูล webhook ไม่ถูกต้อง');
    }
    return this.payments.confirm({ intentId, txnId, amountSatang });
  }
}
