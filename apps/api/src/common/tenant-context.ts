/**
 * บริบทร้าน (tenant) ของงานที่กำลังทำ — ใช้กำหนดว่าคำสั่ง SQL รันในนามร้านไหน
 *
 * ทุกร้านใช้ฐานข้อมูลเดียวกัน แยกข้อมูลด้วยคอลัมน์ "tenantId" และให้ PostgreSQL บังคับเอง (Row-Level Security)
 * ทุกครั้งที่แอปยืม connection จาก pool จะตั้ง role = pos_app และ app.tenant_id = ร้านปัจจุบัน
 * (ดู installTenantGuard) — ต่อให้โค้ดลืมกรอง tenant ก็อ่าน/เขียนข้อมูลร้านอื่นไม่ได้
 *
 * โหมด:
 *  - tenant  : งานปกติของร้านหนึ่ง (หลังล็อกอิน / หลังแปลงโทเค็น QR เป็นร้านแล้ว)
 *  - system  : เฉพาะจุดที่ต้องค้นข้ามร้านก่อนรู้ว่าเป็นร้านไหน (ล็อกอินด้วยรหัสร้าน, โทเค็น QR, webhook)
 *              ต้องเรียกผ่าน runAsSystem() อย่างชัดเจนเท่านั้น และควรอ่านอย่างเดียว
 *  - ไม่มีบริบท: fail-closed — มองไม่เห็นข้อมูลของร้านใดเลย และเขียนไม่ได้
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface DbContext {
  tenantId?: string;
  system?: boolean;
}

const als = new AsyncLocalStorage<DbContext>();

export const currentDbContext = (): DbContext | undefined => als.getStore();

export function runAsTenant<T>(tenantId: string, fn: () => T): T {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('tenantId ไม่ถูกต้อง');
  return als.run({ tenantId }, fn);
}

export function runAsSystem<T>(fn: () => T): T {
  return als.run({ system: true }, fn);
}

/** ใช้ภายในเท่านั้น: เริ่มบริบทว่าง (fail-closed) ให้คำขอ HTTP */
export function runWithContext<T>(ctx: DbContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** คีย์บอกสถานะที่ตั้งไว้บน connection — ถ้าตรงกับที่ต้องการแล้วไม่ต้องตั้งซ้ำ */
export function contextKey(ctx: DbContext | undefined): string {
  if (ctx?.system) return 'system';
  if (ctx?.tenantId) return `t:${ctx.tenantId}`;
  return 'none';
}
