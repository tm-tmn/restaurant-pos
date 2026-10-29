/**
 * ทดสอบการแยกข้อมูลระหว่างร้าน (multi-tenant + Row-Level Security)
 *   DATABASE_URL=... API_URL=http://localhost:3000/api node scripts/tenants.mjs
 * ต้อง build API แล้ว (ใช้ dist/tenants/create-tenant.js สร้างร้านทดสอบ) และ start API ด้วย TRUST_PROXY=1
 * ร้าน A = ร้านจาก seed (SHOP, ค่าเริ่มต้น main) · ร้าน B = สร้างใหม่ทุกครั้ง
 * สร้างข้อมูลทดสอบจริง ห้ามรันกับ production
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SHOP = process.env.SHOP ?? 'main';
const DB = process.env.DATABASE_URL;
assert.ok(DB, 'ต้องตั้ง DATABASE_URL (ใช้สร้างร้านทดสอบและตรวจ RLS ที่ระดับฐานข้อมูล)');
const here = dirname(fileURLToPath(import.meta.url));

let token = '';
const ip = `10.77.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
async function call(method, path, body, expect) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${text}`);
  else assert.ok(res.ok, `${method} ${path} → ${res.status} ${text}`);
  return json;
}
const as = async (t, fn) => {
  const prev = token;
  token = t;
  try {
    return await fn();
  } finally {
    token = prev;
  }
};
const ok = (m) => console.log('✓', m);

// ---------- ร้าน B ----------
const B = `iso-${Date.now() % 1_000_000}`;
const passB = 'shop-b-pass-1';
execFileSync(process.execPath, [join(here, '../dist/tenants/create-tenant.js'), '--slug', B, '--name', 'ร้านทดสอบ B', '--password', passB, '--tables', '2'], {
  env: process.env,
  stdio: 'pipe',
});
// รันซ้ำต้องไม่พัง (idempotent)
execFileSync(process.execPath, [join(here, '../dist/tenants/create-tenant.js'), '--slug', B, '--name', 'ร้านทดสอบ B', '--password', passB], { env: process.env, stdio: 'pipe' });
ok(`สร้างร้าน ${B} ด้วยสคริปต์ผู้ดูแลระบบ (รันซ้ำได้)`);

// ---------- ล็อกอินแยกร้าน ----------
const a = await call('POST', '/auth/login', { tenant: SHOP, username: 'owner', password: process.env.OWNER_PASSWORD ?? 'ChangeMe!2026' }, 201);
const b = await call('POST', '/auth/login', { tenant: B, username: 'owner', password: passB }, 201);
assert.equal(b.tenant.slug, B);
// username เดียวกัน (owner) คนละร้าน รหัสผ่านคนละชุด — สลับร้านต้องเข้าไม่ได้
const badA = await call('POST', '/auth/login', { tenant: SHOP, username: 'owner', password: passB }, 401);
const badShop = await call('POST', '/auth/login', { tenant: 'no-such-shop', username: 'owner', password: passB }, 401);
assert.equal(badA.message, badShop.message, 'ข้อความต้องเหมือนกัน ไม่บอกว่ารหัสร้านมีจริงหรือไม่');
await call('POST', '/auth/login', { tenant: 'BAD SHOP!', username: 'owner', password: 'x' }, 401);
const me = await as(b.token, () => call('GET', '/auth/me'));
assert.equal(me.tenant.slug, B);
ok('ล็อกอินด้วยรหัสร้าน: ชื่อผู้ใช้ซ้ำกันได้คนละร้าน, สลับร้านเข้าไม่ได้, ข้อความผิดพลาดไม่บอกใบ้');

// ---------- ข้อมูลของ A ----------
const menuA = await as(a.token, () => call('GET', '/catalog/menu'));
const pA = menuA.products[0];
const catA = menuA.categories[0];
const tablesA = await as(a.token, () => call('GET', '/tables/qr'));
const tA = tablesA[0];
const ingA = (await as(a.token, () => call('GET', '/inventory/ingredients')))[0];
const branchesA = await as(a.token, () => call('GET', '/branches'));
const clientId = randomUUID();
const orderA = await as(a.token, async () => {
  if (!(await call('GET', '/shifts/current'))) await call('POST', '/shifts/open', { openingCashSatang: 0 });
  const tFree = await call('POST', '/tables', { name: `ISO${Date.now() % 100000}`, seats: 2 }, 201);
  return call('POST', '/orders', { clientId, type: 'dine_in', tableId: tFree.id, items: [{ productId: pA.id, qty: 1 }] }, 201);
});

// ---------- B มองไม่เห็นข้อมูล A ----------
await as(b.token, async () => {
  const menuB = await call('GET', '/catalog/menu');
  assert.equal(menuB.products.length, 0, 'ร้านใหม่ต้องไม่เห็นเมนูร้านอื่น');
  assert.equal(menuB.categories.length, 0);
  const brs = await call('GET', '/branches');
  assert.equal(brs.length, 1);
  assert.ok(!brs.some((x) => branchesA.some((y) => y.id === x.id)));
  assert.equal((await call('GET', '/tables')).length, 2);
  assert.equal((await call('GET', '/inventory/ingredients')).length, 0);
  assert.equal((await call('GET', '/users')).length, 1);
  assert.equal((await call('GET', '/orders')).length, 0);
  assert.equal((await call('GET', '/kitchen')).length, 0);
  await call('GET', `/orders/${orderA.id}`, undefined, 404);
  const daily = await call('GET', '/reports/daily');
  assert.equal(daily.summary?.orders ?? daily.orders ?? 0, 0);
  const audit = await call('GET', '/reports/audit');
  assert.ok(audit.every((r) => r.action !== 'order.create' || r.entityId !== orderA.id));
});
ok('ร้าน B ไม่เห็นเมนู/โต๊ะ/วัตถุดิบ/ผู้ใช้/บิล/ครัว/รายงานของร้าน A');

// ---------- B แตะข้อมูล A ไม่ได้ แม้รู้ id ----------
await as(b.token, async () => {
  await call('POST', `/orders/${orderA.id}/items`, { items: [{ productId: pA.id, qty: 1 }] }, 404);
  await call('POST', `/orders/${orderA.id}/void`, { reason: 'แอบยกเลิก' }, 404);
  await call('PATCH', `/catalog/products/${pA.id}`, { priceSatang: 1 }, 404);
  // อ้างอิงข้อมูลร้านอื่นตอนสร้างข้อมูลใหม่
  await call('POST', '/orders', { clientId: randomUUID(), type: 'takeaway', items: [{ productId: pA.id, qty: 1 }] }, 400);
  const tB = (await call('GET', '/tables'))[0];
  await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: tA.id, items: [] }, 400);
  await call('POST', '/catalog/products', { name: 'แอบผูกหมวดร้านอื่น', priceSatang: 100, categoryId: catA.id }, 400);
  const pB = await call('POST', '/catalog/products', { name: 'เมนู B', priceSatang: 5000, barcode: menuA.products.find((p) => p.barcode)?.barcode ?? '885000' }, 201);
  await call('PUT', `/inventory/recipes/${pB.id}`, { items: [{ ingredientId: ingA.id, qty: 1 }] }, 400);
  await call('PUT', `/inventory/recipes/${pA.id}`, { items: [] }, 404);
  await call('POST', '/inventory/transfer', { toBranchId: branchesA[0].id, items: [{ ingredientId: ingA.id, qty: 1 }] }, 404);
  void tB;
});
ok('ร้าน B แก้/อ้างอิงบิล เมนู หมวด โต๊ะ วัตถุดิบ สาขา ของร้าน A ไม่ได้ (แม้รู้ id) · บาร์โค้ดซ้ำข้ามร้านได้');

// A ยังเห็นของตัวเองครบ และไม่เห็นของ B
await as(a.token, async () => {
  const o = await call('GET', `/orders/${orderA.id}`);
  assert.equal(o.items.length, 1);
  assert.ok(!(await call('GET', '/catalog/menu')).products.some((p) => p.name === 'เมนู B'));
  await call('POST', `/orders/${orderA.id}/void`, { reason: 'ทดสอบแยกร้าน' });
});
ok('ร้าน A ไม่ได้รับผลกระทบ');

// ---------- ลิงก์สาธารณะ ----------
const pageA = await call('GET', `/public/t/${tA.qrToken}`, undefined, 200);
assert.ok(pageA.menu.products.some((p) => p.id === pA.id));
assert.ok(!pageA.menu.products.some((p) => p.name === 'เมนู B'));
await call('POST', `/public/queue/${B}/MAIN`, { partySize: 2 }, 200);
await call('GET', `/public/queue/${B}/MAIN/board`, undefined, 200);
await call('GET', `/public/queue/no-such-shop/MAIN/board`, undefined, 404);
ok('หน้า QR โต๊ะแสดงเมนูของร้านเจ้าของโต๊ะเท่านั้น · ลิงก์คิวแยกตามรหัสร้าน');

// ---------- ระดับฐานข้อมูล: RLS ต้องบังคับจริง ไม่ใช่แค่โค้ดกรอง ----------
const client = new pg.Client({ connectionString: DB });
await client.connect();
try {
  const [{ id: tidA }] = (await client.query('SELECT id FROM tenants WHERE slug = $1', [SHOP])).rows;
  const [{ id: tidB }] = (await client.query('SELECT id FROM tenants WHERE slug = $1', [B])).rows;
  const [{ id: catOfA }] = (await client.query('SELECT id FROM categories WHERE "tenantId" = $1 LIMIT 1', [tidA])).rows;
  await client.query(`SELECT set_config('role', 'pos_app', false), set_config('app.tenant_id', '', false)`);
  assert.equal((await client.query('SELECT count(*)::int n FROM orders')).rows[0].n, 0, 'ไม่มีบริบทร้าน ต้องไม่เห็นอะไรเลย');
  assert.equal((await client.query('SELECT count(*)::int n FROM tenants')).rows[0].n, 0);
  await assert.rejects(client.query(`INSERT INTO categories (name) VALUES ('x')`), /violates|null value/);

  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [tidB]);
  assert.equal((await client.query('SELECT count(*)::int n FROM products WHERE "tenantId" = $1', [tidA])).rows[0].n, 0);
  assert.equal((await client.query('SELECT count(*)::int n FROM tenants')).rows[0].n, 1);
  await assert.rejects(client.query(`INSERT INTO categories (name, "tenantId") VALUES ('x', $1)`, [tidA]), /row-level security/);
  const upd = await client.query(`UPDATE products SET "priceSatang" = 1 WHERE "tenantId" = $1`, [tidA]);
  assert.equal(upd.rowCount, 0);
  await client.query(`INSERT INTO categories (name) VALUES ('หมวดของ B')`); // ร้านตัวเองเขียนได้ (tenantId มาจาก app.tenant_id)
  await assert.rejects(client.query(`UPDATE categories SET "tenantId" = $1`, [tidA]), /row-level security/);
  // FK ไม่สน RLS → trigger ต้องกันการผูกกับ id ของร้านอื่น
  await assert.rejects(client.query(`INSERT INTO products (name, "priceSatang", "categoryId") VALUES ('x', 1, $1)`, [catOfA]), /อ้างอิงข้อมูลที่ไม่มีอยู่ในร้านนี้/);
  await assert.rejects(client.query(`UPDATE tenants SET name = 'x'`), /permission denied/);
  await assert.rejects(client.query(`SELECT * FROM migrations`), /permission denied/);
} finally {
  await client.end();
}
ok('ระดับฐานข้อมูล: role pos_app ไม่มีบริบท = ไม่เห็นอะไร, เขียน/ย้ายข้อมูลไปร้านอื่นไม่ได้, แก้ตารางร้าน/ระบบไม่ได้');

console.log('\nTENANT ISOLATION TEST PASSED');
