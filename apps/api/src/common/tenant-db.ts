import { DataSource } from 'typeorm';
import { contextKey, currentDbContext } from './tenant-context';

/** role ที่ไม่มีสิทธิ์ข้าม RLS — แอปทำงานในนาม role นี้เสมอ ยกเว้นโหมด system */
export const APP_ROLE = 'pos_app';

type PgClient = { query: (sql: string, params?: unknown[]) => Promise<unknown>; __posCtx?: string };
type Release = (err?: unknown) => void;

/**
 * ครอบการยืม connection ของ TypeORM: ก่อนส่ง connection ให้ใช้งาน ตั้งค่าให้ตรงกับบริบทร้านของงานนั้น
 *   tenant → SET ROLE pos_app + app.tenant_id = ร้าน
 *   ไม่มีบริบท → SET ROLE pos_app + app.tenant_id = '' (มองไม่เห็นอะไร)
 *   system → RESET ROLE (กลับเป็นผู้ใช้ที่ต่อฐานข้อมูล — เจ้าของตาราง จึงไม่ติด RLS)
 * ใช้ set_config แบบระดับ session และจำไว้บน connection เพื่อไม่ต้องตั้งซ้ำทุกคำสั่ง
 *
 * ต้องเรียกหลัง DataSource initialize (และหลังรัน migration) เท่านั้น
 */
export function installTenantGuard(ds: DataSource) {
  const driver = ds.driver as unknown as { obtainMasterConnection: () => Promise<[PgClient, Release]> };
  const original = driver.obtainMasterConnection.bind(driver);
  driver.obtainMasterConnection = async () => {
    const [conn, release] = await original();
    const ctx = currentDbContext();
    const want = contextKey(ctx);
    if (conn.__posCtx !== want) {
      try {
        if (ctx?.system) {
          await conn.query(`SELECT set_config('role', 'none', false), set_config('app.tenant_id', '', false)`);
        } else {
          await conn.query(`SELECT set_config('role', $1, false), set_config('app.tenant_id', $2, false)`, [APP_ROLE, ctx?.tenantId ?? '']);
        }
        conn.__posCtx = want;
      } catch (e) {
        conn.__posCtx = undefined;
        release(e);
        throw e;
      }
    }
    return [conn, release];
  };
}
