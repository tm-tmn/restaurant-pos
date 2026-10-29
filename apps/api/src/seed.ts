/**
 * ข้อมูลตั้งต้นสำหรับพัฒนา/ทดลอง: ร้าน, สาขา, ผู้ใช้, โต๊ะ, เมนูตัวอย่าง
 * ร้านใหม่สำหรับลูกค้าจริงให้ใช้ npm run tenant:create (ดู src/tenants/create-tenant.ts)
 * รัน: npm run seed   (ต้องมี DATABASE_URL ใน apps/api/.env)
 * รันซ้ำได้ — ถ้ามีข้อมูลแล้วจะไม่สร้างซ้ำ
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { runAsTenant } from './common/tenant-context';
import { installTenantGuard } from './common/tenant-db';
import { BaseUnit, Category, Ingredient, Product, RecipeItem } from './entities';
import { provisionTenant } from './tenants/provision';

config();

async function main() {
  // ใช้การตั้งค่าเดียวกับแอป: รัน migration ที่ค้างก่อน
  const ds = await new DataSource(dataSourceOptions()).initialize();
  // ทำงานเหมือนแอปจริง: ทุกคำสั่งอยู่ภายใต้ Row-Level Security ของร้านที่กำลัง seed
  installTenantGuard(ds);

  // ร้านตัวอย่าง — ระบบที่อัปเกรดจากรุ่นก่อนมีร้าน "main" (ข้อมูลเดิม) อยู่แล้ว
  const slug = process.env.SEED_TENANT_SLUG ?? 'main';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe!2026';
  const { tenant, created } = await provisionTenant(ds, { slug, name: process.env.SEED_TENANT_NAME ?? 'ร้านตัวอย่าง', ownerPassword: password });
  if (created) {
    console.log(`สร้างร้าน "${tenant.slug}" แล้ว — ผู้ใช้ owner (รหัสผ่านตั้งต้น: ${process.env.SEED_OWNER_PASSWORD ? 'จาก SEED_OWNER_PASSWORD' : password})`);
    console.log('อย่าลืมเปลี่ยนรหัสผ่าน และตั้ง promptpayId ของสาขาเพื่อใช้ QR PromptPay');
  }
  await runAsTenant(tenant.id, () => seedMenu(ds));
  await ds.destroy();
  console.log('seed เสร็จแล้ว');
}

/** เมนู วัตถุดิบ และสูตรตัวอย่าง (เฉพาะร้านที่ยังไม่มีหมวดหมู่) */
async function seedMenu(ds: DataSource) {
  const cats = ds.getRepository(Category);
  if ((await cats.count()) === 0) {
    const menu: Record<string, [string, number, string?][]> = {
      อาหารจานเดียว: [
        ['ข้าวกะเพราหมูสับไข่ดาว', 6000, '8850000000011'],
        ['ข้าวผัดกุ้ง', 7000, '8850000000028'],
        ['ผัดไทยกุ้งสด', 8000],
        ['ข้าวมันไก่', 5500],
      ],
      เครื่องดื่ม: [
        ['ชาไทยเย็น', 4500],
        ['กาแฟเย็น', 5000],
        ['น้ำเปล่า', 1000, '8850000000035'],
      ],
      ของหวาน: [['ข้าวเหนียวมะม่วง', 9000]],
    };
    let order = 0;
    for (const [name, items] of Object.entries(menu)) {
      const c = await cats.save({ name, sortOrder: order++ });
      await ds.getRepository(Product).save(
        items.map(([pname, price, barcode], i) => ({ name: pname, priceSatang: price, categoryId: c.id, sortOrder: i, barcode: barcode ?? null })),
      );
    }
  }
  // ---- Phase 2: วัตถุดิบ + สูตรตัวอย่าง (ยังไม่มีสต็อก — ให้รับเข้าผ่านหน้าคลังสินค้า) ----
  const ingRepo = ds.getRepository(Ingredient);
  if ((await ingRepo.count()) === 0) {
    const defs: [string, BaseUnit, number][] = [
      ['ข้าวสาร', 'g', 5000],
      ['หมูสับ', 'g', 2000],
      ['ไข่ไก่', 'pcs', 30],
      ['ใบกะเพรา', 'g', 300],
      ['กุ้ง', 'g', 1000],
      ['เส้นจันทน์', 'g', 1000],
      ['ชาไทย (ผง)', 'g', 500],
      ['นมข้นหวาน', 'ml', 1000],
      ['น้ำดื่ม (ขวด)', 'pcs', 24],
    ];
    const ing = new Map<string, string>();
    for (const [name, unit, reorderLevel] of defs) ing.set(name, (await ingRepo.save({ name, unit, reorderLevel })).id);
    const recipes: Record<string, [string, number][]> = {
      ข้าวกะเพราหมูสับไข่ดาว: [['ข้าวสาร', 120], ['หมูสับ', 100], ['ไข่ไก่', 1], ['ใบกะเพรา', 10]],
      ข้าวผัดกุ้ง: [['ข้าวสาร', 150], ['กุ้ง', 80], ['ไข่ไก่', 1]],
      ผัดไทยกุ้งสด: [['เส้นจันทน์', 120], ['กุ้ง', 80], ['ไข่ไก่', 1]],
      ชาไทยเย็น: [['ชาไทย (ผง)', 15], ['นมข้นหวาน', 30]],
      น้ำเปล่า: [['น้ำดื่ม (ขวด)', 1]],
    };
    for (const [pname, lines] of Object.entries(recipes)) {
      const p = await ds.getRepository(Product).findOneBy({ name: pname });
      if (!p) continue;
      await ds.getRepository(RecipeItem).save(lines.map(([iname, qty]) => ({ productId: p.id, ingredientId: ing.get(iname)!, qty })));
    }
    console.log('สร้างวัตถุดิบและสูตรตัวอย่างแล้ว');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
