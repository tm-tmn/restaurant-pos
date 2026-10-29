/**
 * สร้างร้านใหม่ (tenant) พร้อมสาขาแรก ผู้ใช้เจ้าของร้าน และโต๊ะ — ใช้โดยสคริปต์ผู้ดูแลระบบและ seed
 * แอปปกติ (role pos_app) สร้างร้านไม่ได้ — ตั้งใจให้ทำได้เฉพาะผู้ดูแลระบบ
 */
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { runAsSystem, runAsTenant } from '../common/tenant-context';
import { Branch, DiningTable, Tenant, User } from '../entities';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
/** คำที่ชนกับเส้นทางของเว็บ (เช่น /q/ticket/...) จึงใช้เป็นรหัสร้านไม่ได้ */
export const RESERVED_SLUGS = new Set(['ticket', 'api', 'admin', 'board', 'login', 'socket-io', 'assets', 'www']);
export const BRANCH_CODE_RE = /^[A-Z0-9]{2,10}$/;

export interface NewTenant {
  slug: string;
  name: string;
  ownerPassword: string;
  ownerUsername?: string;
  branchCode?: string;
  branchName?: string;
  tables?: number;
}

export interface ProvisionResult {
  tenant: Tenant;
  branch: Branch;
  created: boolean;
}

/**
 * idempotent: ถ้ามีรหัสร้านนี้แล้วจะคืนร้านเดิม (และสร้างเฉพาะส่วนที่ยังไม่มี เช่น สาขาแรก/เจ้าของร้าน)
 * ต้องเรียกกับ DataSource ที่ติดตั้ง installTenantGuard แล้ว
 */
export async function provisionTenant(ds: DataSource, input: NewTenant): Promise<ProvisionResult> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error('รหัสร้านใช้ได้เฉพาะ a-z 0-9 และ - ยาว 2-31 ตัว (ขึ้นต้นด้วยตัวอักษรหรือตัวเลข)');
  if (RESERVED_SLUGS.has(slug)) throw new Error(`ใช้ "${slug}" เป็นรหัสร้านไม่ได้ (คำสงวนของระบบ)`);
  const branchCode = (input.branchCode ?? 'MAIN').toUpperCase();
  if (!BRANCH_CODE_RE.test(branchCode)) throw new Error('รหัสสาขาใช้ A-Z, 0-9 ยาว 2-10 ตัว');
  if (input.ownerPassword.length < 8) throw new Error('รหัสผ่านเจ้าของร้านต้องยาวอย่างน้อย 8 ตัวอักษร');

  // สร้างแถวในตาราง tenants ได้เฉพาะโหมด system
  let created = false;
  let tenant = await runAsSystem(() => ds.getRepository(Tenant).findOneBy({ slug }));
  if (!tenant) {
    tenant = await runAsSystem(() => ds.getRepository(Tenant).save(ds.getRepository(Tenant).create({ slug, name: input.name })));
    created = true;
  }
  const tid = tenant.id;

  const branch = await runAsTenant(tid, async () => {
    const branches = ds.getRepository(Branch);
    let b = await branches.findOneBy({ code: branchCode });
    if (!b) {
      b = await branches.save(
        branches.create({ code: branchCode, name: input.branchName ?? 'สาขาหลัก', promptpayId: null, qrOrdering: true, qrRequireApproval: true }),
      );
    }
    const users = ds.getRepository(User);
    if ((await users.countBy({ role: 'owner' })) === 0) {
      await users.save(
        users.create({
          branchId: b.id,
          username: input.ownerUsername ?? 'owner',
          displayName: 'เจ้าของร้าน',
          role: 'owner',
          passwordHash: await bcrypt.hash(input.ownerPassword, 10),
        }),
      );
    }
    const tables = ds.getRepository(DiningTable);
    const n = input.tables ?? 8;
    if (n > 0 && (await tables.countBy({ branchId: b.id })) === 0) {
      // ใช้ create() เพื่อให้ @BeforeInsert สร้าง qrToken
      await tables.save(Array.from({ length: n }, (_, i) => tables.create({ branchId: b!.id, name: `T${i + 1}`, seats: 4 })));
    }
    return b;
  });
  return { tenant, branch, created };
}
