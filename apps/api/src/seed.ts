/**
 * ข้อมูลตั้งต้นสำหรับพัฒนา/ทดลอง: สาขา, ผู้ใช้, โต๊ะ, เมนูตัวอย่าง
 * รัน: npm run seed   (ต้องมี DATABASE_URL ใน apps/api/.env)
 * รันซ้ำได้ — ถ้ามีข้อมูลแล้วจะไม่สร้างซ้ำ
 */
import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES, Branch, Category, DiningTable, Product, User } from './entities';

config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ไม่พบ DATABASE_URL');
  const ds = await new DataSource({ type: 'postgres', url, entities: ALL_ENTITIES, synchronize: true }).initialize();

  let branch = await ds.getRepository(Branch).findOneBy({ code: 'MAIN' });
  if (!branch) {
    branch = await ds.getRepository(Branch).save({ code: 'MAIN', name: 'สาขาหลัก', promptpayId: null });
    console.log('สร้างสาขา MAIN แล้ว — อย่าลืมตั้ง promptpayId ของร้านเพื่อใช้ QR PromptPay');
  }

  const users = ds.getRepository(User);
  if ((await users.count()) === 0) {
    // รหัสผ่านตั้งต้นต้องเปลี่ยนทันทีหลังเข้าระบบครั้งแรก
    const password = process.env.SEED_OWNER_PASSWORD ?? 'ChangeMe!2026';
    await users.save({
      branchId: branch.id,
      username: 'owner',
      displayName: 'เจ้าของร้าน',
      role: 'owner',
      passwordHash: await bcrypt.hash(password, 10),
    });
    console.log(`สร้างผู้ใช้ owner แล้ว (รหัสผ่านตั้งต้น: ${process.env.SEED_OWNER_PASSWORD ? 'จาก SEED_OWNER_PASSWORD' : password})`);
  }

  const tables = ds.getRepository(DiningTable);
  if ((await tables.count({ where: { branchId: branch.id } })) === 0) {
    await tables.save(Array.from({ length: 8 }, (_, i) => ({ branchId: branch.id, name: `T${i + 1}`, seats: 4 })));
  }

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
  await ds.destroy();
  console.log('seed เสร็จแล้ว');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
