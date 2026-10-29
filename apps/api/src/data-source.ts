/**
 * DataSource สำหรับ TypeORM CLI (สร้าง/รัน migration) และสคริปต์ seed
 *   npm run migration:generate -- src/migrations/ชื่อ   สร้าง migration จากความต่างของ entity กับฐานข้อมูล
 *   npm run migration:run                              รัน migration ที่ค้าง
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { join } from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

config();

export function dataSourceOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ไม่พบ DATABASE_URL');
  if (process.env.DB_SYNC === 'true') {
    throw new Error('DB_SYNC=true เลิกใช้แล้ว (ระบบหลายร้านต้องสร้างตารางด้วย migration) — ตั้ง DB_SYNC=false หรือลบบรรทัดนี้ออกจาก .env');
  }
  return {
    type: 'postgres',
    url,
    entities: ALL_ENTITIES,
    migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
    // สร้าง/อัปเดตตารางด้วย migration เสมอ — synchronize สร้าง Row-Level Security, role และ trigger ที่ใช้แยกร้านไม่ได้
    synchronize: false,
    migrationsRun: true,
  };
}

export default new DataSource(dataSourceOptions());
