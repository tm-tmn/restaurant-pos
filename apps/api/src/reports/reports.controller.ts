import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';

const TZ = 'Asia/Bangkok';

@Roles('manager')
@Controller('reports')
export class ReportsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** สรุปยอดขายรายวัน (วันตามเวลาไทย) เฉพาะบิลที่ชำระแล้ว */
  @Get('daily')
  async daily(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    const day = date ?? new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
      throw new BadRequestException('date ต้องเป็นรูปแบบ YYYY-MM-DD');
    }
    const from = new Date(`${day}T00:00:00+07:00`);
    const to = new Date(from.getTime() + 24 * 3600_000);
    const p = [u.branchId, from, to];

    const [totals] = await this.ds.query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM("totalSatang"),0)::int AS "salesSatang",
              COALESCE(SUM("discountSatang"),0)::int AS "discountSatang"
         FROM orders
        WHERE "branchId" = $1 AND status = 'paid' AND "paidAt" >= $2 AND "paidAt" < $3`,
      p,
    );

    const byMethod = await this.ds.query(
      `SELECT pay.method, COALESCE(SUM(pay."amountSatang"),0)::int AS "amountSatang", COUNT(*)::int AS count
         FROM payments pay JOIN orders o ON o.id = pay."orderId"
        WHERE o."branchId" = $1 AND o.status = 'paid' AND o."paidAt" >= $2 AND o."paidAt" < $3
        GROUP BY pay.method ORDER BY 2 DESC`,
      p,
    );

    const topProducts = await this.ds.query(
      `SELECT i."nameSnapshot" AS name, SUM(i.qty)::int AS qty,
              SUM(i.qty * i."unitPriceSatang")::int AS "salesSatang"
         FROM order_items i JOIN orders o ON o.id = i."orderId"
        WHERE o."branchId" = $1 AND o.status = 'paid' AND i.status = 'active'
          AND o."paidAt" >= $2 AND o."paidAt" < $3
        GROUP BY i."nameSnapshot" ORDER BY 2 DESC, 3 DESC LIMIT 10`,
      p,
    );

    const hourly = await this.ds.query(
      `SELECT EXTRACT(HOUR FROM o."paidAt" AT TIME ZONE '${TZ}')::int AS hour,
              COUNT(*)::int AS orders, COALESCE(SUM(o."totalSatang"),0)::int AS "salesSatang"
         FROM orders o
        WHERE o."branchId" = $1 AND o.status = 'paid' AND o."paidAt" >= $2 AND o."paidAt" < $3
        GROUP BY 1 ORDER BY 1`,
      p,
    );

    const [voids] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE action = 'order.void')::int AS "voidedOrders",
              COUNT(*) FILTER (WHERE action = 'order_item.void')::int AS "voidedItems"
         FROM audit_logs
        WHERE "branchId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3`,
      p,
    );

    // ต้นทุนขาย (COGS) จากการหักวัตถุดิบตามสูตรของบิลที่ชำระในวันนั้น
    const [{ cogs }] = await this.ds.query(
      `SELECT COALESCE(-SUM(m."valueDeltaSatang"),0)::bigint AS cogs
         FROM stock_movements m JOIN orders o ON o.id = m."refId"
        WHERE m."refType" = 'order' AND m.type = 'sale'
          AND o."branchId" = $1 AND o.status = 'paid' AND o."paidAt" >= $2 AND o."paidAt" < $3`,
      p,
    );
    const [{ waste }] = await this.ds.query(
      `SELECT COALESCE(-SUM("valueDeltaSatang"),0)::bigint AS waste
         FROM stock_movements WHERE "branchId" = $1 AND type = 'waste' AND "createdAt" >= $2 AND "createdAt" < $3`,
      p,
    );
    const cogsSatang = Number(cogs);
    const stock = { cogsSatang, grossProfitSatang: totals.salesSatang - cogsSatang, wasteSatang: Number(waste) };

    const avg = totals.orders > 0 ? Math.round(totals.salesSatang / totals.orders) : 0;
    return { date: day, ...totals, avgOrderSatang: avg, ...voids, ...stock, byMethod, topProducts, hourly };
  }
}
