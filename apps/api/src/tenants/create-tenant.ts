/**
 * สร้างร้านใหม่ให้ลูกค้า (สำหรับผู้ดูแลระบบ)
 *
 *   npm run tenant:create -w apps/api -- --slug somtam-pa --name "ส้มตำป้า" --password 'รหัสผ่านเจ้าของร้าน'
 *   (บน Railway: railway run npm run tenant:create -w apps/api -- ...)
 *
 * ตัวเลือก: --branch-code MAIN  --branch-name "สาขาหลัก"  --owner owner  --tables 8
 * ร้านที่มีอยู่แล้วจะไม่ถูกสร้างซ้ำ (สร้างเฉพาะส่วนที่ขาด)
 * ถ้าไม่ใส่ --password จะใช้ตัวแปร TENANT_OWNER_PASSWORD (ไม่ให้รหัสผ่านค้างใน history ของ shell)
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';
import { installTenantGuard } from '../common/tenant-db';
import { dataSourceOptions } from '../data-source';
import { provisionTenant } from './provision';

config();

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
      owner: { type: 'string' },
      'branch-code': { type: 'string' },
      'branch-name': { type: 'string' },
      tables: { type: 'string' },
    },
  });
  const ownerPassword = values.password ?? process.env.TENANT_OWNER_PASSWORD;
  if (!values.slug || !values.name || !ownerPassword) {
    console.error('ต้องระบุ --slug, --name และ --password (หรือ TENANT_OWNER_PASSWORD)');
    process.exit(2);
  }
  const ds = await new DataSource(dataSourceOptions()).initialize();
  installTenantGuard(ds);
  try {
    const r = await provisionTenant(ds, {
      slug: values.slug,
      name: values.name,
      ownerPassword,
      ownerUsername: values.owner,
      branchCode: values['branch-code'],
      branchName: values['branch-name'],
      tables: values.tables ? Number(values.tables) : undefined,
    });
    console.log(
      r.created
        ? `สร้างร้าน "${r.tenant.slug}" (${r.tenant.name}) แล้ว — สาขา ${r.branch.code}, ผู้ใช้ ${values.owner ?? 'owner'}`
        : `มีร้าน "${r.tenant.slug}" อยู่แล้ว — ตรวจและเติมส่วนที่ขาดเรียบร้อย`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
