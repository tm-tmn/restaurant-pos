import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsIn } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import type { KitchenStatus } from '../entities';

const STATUSES: KitchenStatus[] = ['new', 'preparing', 'ready', 'served'];

class SetStatusDto {
  @IsIn(STATUSES) status: KitchenStatus;
}

/** จอครัว (KDS): รายการที่เข้าบิลแล้วและยังไม่เสิร์ฟ เรียงตามเวลาที่สั่ง */
@Controller('kitchen')
export class KitchenController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async board(@CurrentUser() u: AuthUser) {
    const rows: {
      orderId: string; orderNo: string; type: string; tableName: string | null; orderStatus: string; itemId: string; name: string; qty: number;
      note: string | null; kitchenStatus: KitchenStatus; source: string; sentAt: string;
    }[] = await this.ds.query(
      `SELECT o.id AS "orderId", o."orderNo", o.type, t.name AS "tableName", o.status AS "orderStatus",
              i.id AS "itemId", i."nameSnapshot" AS name, i.qty, i.note, i."kitchenStatus", i.source, i."sentToKitchenAt" AS "sentAt"
         FROM order_items i
         JOIN orders o ON o.id = i."orderId"
         LEFT JOIN dining_tables t ON t.id = o."tableId"
        WHERE o."branchId" = $1 AND o.status IN ('open', 'paid')
          AND i.status = 'active' AND i."kitchenStatus" <> 'served' AND i."sentToKitchenAt" IS NOT NULL
          AND i."sentToKitchenAt" > now() - interval '24 hours'
        ORDER BY i."sentToKitchenAt", i.id
        LIMIT 500`,
      [u.branchId],
    );
    const tickets = new Map<string, { orderId: string; orderNo: string; type: string; tableName: string | null; sentAt: string; items: unknown[] }>();
    for (const r of rows) {
      const tk = tickets.get(r.orderId) ?? { orderId: r.orderId, orderNo: r.orderNo, type: r.type, tableName: r.tableName, sentAt: r.sentAt, items: [] };
      tk.items.push({ id: r.itemId, name: r.name, qty: r.qty, note: r.note, status: r.kitchenStatus, source: r.source, sentAt: r.sentAt });
      tickets.set(r.orderId, tk);
    }
    return [...tickets.values()];
  }

  @Patch('items/:id')
  async setItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) {
    // เงื่อนไข branch อยู่ใน SQL เดียว — ไม่ต้องอ่านก่อนเขียน
    const res: [unknown[], number] = await this.ds.query(
      `UPDATE order_items i SET "kitchenStatus" = $1
         FROM orders o
        WHERE i.id = $2 AND o.id = i."orderId" AND o."branchId" = $3 AND i.status = 'active'`,
      [dto.status, id, u.branchId],
    );
    if (!res[1]) throw new NotFoundException('ไม่พบรายการ');
    return { ok: true };
  }

  /** เปลี่ยนสถานะทุกรายการของบิลที่ยังไม่เสิร์ฟ (เช่น กด "พร้อมเสิร์ฟทั้งบิล") */
  @Post('orders/:orderId/status')
  @HttpCode(200)
  async setOrder(@CurrentUser() u: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: SetStatusDto) {
    if (dto.status === 'new') throw new BadRequestException('ย้อนกลับเป็น "ใหม่" ได้ทีละรายการเท่านั้น');
    const res: [unknown[], number] = await this.ds.query(
      `UPDATE order_items i SET "kitchenStatus" = $1
         FROM orders o
        WHERE i."orderId" = $2 AND o.id = i."orderId" AND o."branchId" = $3 AND i.status = 'active' AND i."kitchenStatus" <> 'served'`,
      [dto.status, orderId, u.branchId],
    );
    return { updated: res[1] };
  }
}
