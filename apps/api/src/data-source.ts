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
  return {
    type: 'postgres',
    url,
    entities: ALL_ENTITIES,
    migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
    // DB_SYNC=true ใช้เฉพาะตอนพัฒนา — ปกติให้ใช้ migration
    synchronize: process.env.DB_SYNC === 'true',
    migrationsRun: process.env.DB_SYNC !== 'true',
  };
}

export default new DataSource(dataSourceOptions());
