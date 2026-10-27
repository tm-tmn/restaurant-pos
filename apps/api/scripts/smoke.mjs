/**
 * Smoke test ของ API ทั้งเส้นทางหลัก — รันกับ API ที่ start อยู่แล้ว และฐานข้อมูลที่ seed แล้ว
 *   API_URL=http://localhost:3000/api OWNER_PASSWORD='ChangeMe!2026' node scripts/smoke.mjs
 * หมายเหตุ: สร้างข้อมูลทดสอบจริงลงฐานข้อมูล ห้ามรันกับฐานข้อมูล production
 */
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
let token = '';

async function call(method, path, body, expectStatus) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (expectStatus !== undefined) assert.equal(res.status, expectStatus, `${method} ${path} → ${res.status} ${text}`);
  else assert.ok(res.ok, `${method} ${path} → ${res.status} ${text}`);
  return json;
}
const ok = (m) => console.log('✓', m);

// --- auth ---
await call('POST', '/auth/login', { username: 'owner', password: 'wrong' }, 401);
const login = await call('POST', '/auth/login', { username: 'owner', password: process.env.OWNER_PASSWORD ?? 'ChangeMe!2026' });
token = login.token;
ok('login');
await call('GET', '/catalog/menu', undefined, 200);
token = '';
await call('GET', '/catalog/menu', undefined, 401);
token = login.token;
ok('endpoint ต้อง login');

// --- cashier ถูกจำกัดสิทธิ์ ---
const uname = `cashier${Date.now() % 100000}`;
await call('POST', '/users', { username: uname, password: 'cashier-pass-1', displayName: 'แคชเชียร์ทดสอบ', role: 'cashier' });
const ownerToken = token;
token = (await call('POST', '/auth/login', { username: uname, password: 'cashier-pass-1' })).token;
await call('GET', '/reports/daily', undefined, 403);
await call('GET', '/users', undefined, 403);
ok('cashier เข้ารายงาน/ผู้ใช้ไม่ได้');
const cashierToken = token;
token = ownerToken;

// --- menu / tables ---
const menu = await call('GET', '/catalog/menu');
assert.ok(menu.products.length >= 3);
const [p1, p2] = menu.products;
const tables = await call('GET', '/tables');
assert.ok(tables.length >= 2);
const t1 = tables[0];

// --- shift ---
await call('GET', '/shifts/current');
const shift = await call('POST', '/shifts/open', { openingCashSatang: 100000 }, 201).catch(() => null);
ok('เปิดกะ' + (shift ? '' : ' (มีกะค้างอยู่แล้ว)'));

// --- เปิดบิลโต๊ะ + เพิ่มรายการ + ยกเลิกรายการ + จ่ายเงิน ---
token = cashierToken;
const clientId = randomUUID();
const o1 = await call('POST', '/orders', { clientId, type: 'dine_in', tableId: t1.id, items: [{ productId: p1.id, qty: 2 }] }, 201);
assert.equal(o1.totalSatang, p1.priceSatang * 2);
const again = await call('POST', '/orders', { clientId, type: 'dine_in', tableId: t1.id, items: [{ productId: p1.id, qty: 2 }] }, 201);
assert.equal(again.id, o1.id, 'ส่ง clientId ซ้ำต้องได้บิลเดิม');
await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: t1.id, items: [{ productId: p1.id, qty: 1 }] }, 409);
ok('เปิดบิลโต๊ะ, idempotent, โต๊ะซ้ำ → 409');

const o2 = await call('POST', `/orders/${o1.id}/items`, { items: [{ productId: p2.id, qty: 1 }] }, 201);
assert.equal(o2.totalSatang, p1.priceSatang * 2 + p2.priceSatang);
const extra = o2.items.find((i) => i.productId === p2.id);
await call('POST', `/orders/${o1.id}/items/${extra.id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' }, 403); // cashier ยกเลิกเองไม่ได้
token = ownerToken;
const o3 = await call('POST', `/orders/${o1.id}/items/${extra.id}/void`, { reason: 'ลูกค้าเปลี่ยนใจ' }, 200);
assert.equal(o3.totalSatang, p1.priceSatang * 2);
ok('เพิ่ม/ยกเลิกรายการ (เฉพาะ manager) คำนวณยอดใหม่ถูก');

token = cashierToken;
await call('POST', `/orders/${o1.id}/pay`, { payments: [{ method: 'cash', amountSatang: o3.totalSatang - 1 }] }, 400);
await call('POST', `/orders/${o1.id}/pay`, { discountSatang: 500, payments: [{ method: 'cash', amountSatang: o3.totalSatang - 500 }] }, 403);
const paid = await call('POST', `/orders/${o1.id}/pay`, { payments: [{ method: 'cash', amountSatang: o3.totalSatang, receivedSatang: o3.totalSatang + 5000 }] }, 200);
assert.equal(paid.status, 'paid');
assert.equal(paid.payments[0].changeSatang, 5000);
await call('POST', `/orders/${o1.id}/pay`, { payments: [{ method: 'cash', amountSatang: o3.totalSatang }] }, 400);
ok('ชำระเงิน: ยอดไม่ตรง → 400, ส่วนลด cashier → 403, เงินทอนถูก, จ่ายซ้ำ → 400');

// --- offline sync (idempotent) ---
const sc = randomUUID();
const syncOrder = {
  clientId: sc,
  type: 'takeaway',
  occurredAt: new Date(Date.now() - 3600_000).toISOString(),
  items: [{ productId: p2.id, name: p2.name, unitPriceSatang: p2.priceSatang, qty: 3 }],
  payments: [{ method: 'promptpay', amountSatang: p2.priceSatang * 3 }],
};
const bad = { ...syncOrder, clientId: randomUUID(), payments: [{ method: 'promptpay', amountSatang: 1 }] };
const r1 = await call('POST', '/sync/orders', { orders: [syncOrder, bad] }, 200);
assert.equal(r1.results[0].status, 'created');
assert.equal(r1.results[1].status, 'rejected');
const r2 = await call('POST', '/sync/orders', { orders: [syncOrder] }, 200);
assert.equal(r2.results[0].status, 'duplicate');
assert.equal(r2.results[0].orderNo, r1.results[0].orderNo);
ok('sync: created / rejected (ยอดไม่ตรง) / ส่งซ้ำ → duplicate เลขบิลเดิม');

// --- รายงาน ---
token = ownerToken;
const rep = await call('GET', '/reports/daily');
assert.ok(rep.orders >= 2 && rep.salesSatang >= paid.totalSatang + p2.priceSatang * 3);
assert.ok(rep.byMethod.some((m) => m.method === 'cash') && rep.byMethod.some((m) => m.method === 'promptpay'));
assert.ok(rep.voidedItems >= 1);
assert.ok(rep.topProducts.length >= 1 && Array.isArray(rep.hourly));
ok(`รายงานรายวัน: ${rep.orders} บิล / ${(rep.salesSatang / 100).toFixed(2)} บาท`);

// --- void บิลเปิด + ปิดกะ ---
const clientId2 = randomUUID();
const ov = await call('POST', '/orders', { clientId: clientId2, type: 'dine_in', tableId: t1.id, items: [{ productId: p1.id, qty: 1 }] }, 201);
const voided = await call('POST', `/orders/${ov.id}/void`, { reason: 'ทดสอบยกเลิกบิล' }, 200);
assert.equal(voided.status, 'void');
await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: t1.id, items: [{ productId: p1.id, qty: 1 }] }, 201); // โต๊ะว่างแล้ว
ok('void บิล → โต๊ะว่างและเปิดบิลใหม่ได้');

const cur = await call('GET', '/shifts/current');
if (cur) {
  const closed = await call('POST', '/shifts/close', { closingCashSatang: 100000 }, 201);
  assert.ok(closed.expectedCashSatang >= 100000);
  ok(`ปิดกะ: เงินสดที่ควรมี ${(closed.expectedCashSatang / 100).toFixed(2)} บาท`);
}
console.log('\nSMOKE TEST PASSED');
