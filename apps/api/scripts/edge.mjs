/**
 * Edge-case / regression test ของ API: ยิงข้อมูลผิดรูปแบบ, ข้อมูลซ้ำ, ตัวเลขล้น, เคสแข่งกัน, สิทธิ์, การเพิกถอนเซสชัน
 * ต้องไม่มีคำตอบ 5xx และทุกเงื่อนไขต้องผ่าน — รันหลัง smoke test (ใช้ข้อมูลจาก seed)
 *   API_URL=http://localhost:3000/api node apps/api/scripts/edge.mjs
 * หมายเหตุ: สร้างข้อมูลทดสอบลงฐานข้อมูล และล็อกบัญชีทดสอบจากการเดารหัส — ห้ามรันกับ production
 */
import { randomUUID } from 'node:crypto';
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const findings = [];
let token = '';
async function call(method, path, body, raw) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (res.status >= 500) findings.push(`5xx ${res.status} ${method} ${path} ${JSON.stringify(body)?.slice(0, 120)} → ${text.slice(0, 120)}`);
  return { s: res.status, j: json };
}
const expect = (label, cond, extra = '') => { if (!cond) findings.push(`BUG ${label} ${extra}`); };

const login = await call('POST', '/auth/login', { username: 'owner', password: 'ChangeMe!2026' });
token = login.j.token;
const owner = token;
const branchId = login.j.branch.id;
const menu = (await call('GET', '/catalog/menu')).j;
const p = menu.products[0];
const sfx = Date.now() % 1e7;

// ---------- malformed bodies ----------
await call('POST', '/auth/login', undefined, '{bad json');
await call('POST', '/auth/login', { username: 123, password: [] });
await call('POST', '/orders', undefined, 'null');
await call('POST', '/orders', { clientId: 'x', type: 'dine_in', items: 'a' });
await call('POST', '/orders', { clientId: randomUUID(), type: 'takeaway', items: [{ productId: randomUUID(), qty: 1 }] });
await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: randomUUID(), items: [{ productId: p.id, qty: 1 }] });
await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', items: [{ productId: p.id, qty: 1 }] });
await call('GET', '/orders/not-a-uuid');
await call('GET', '/orders/' + randomUUID());
await call('POST', `/orders/${randomUUID()}/pay`, { payments: [{ method: 'cash', amountSatang: 100 }] });
await call('POST', `/orders/${randomUUID()}/items`, { items: [{ productId: p.id, qty: 1 }] });
await call('POST', `/orders/${randomUUID()}/void`, { reason: 'xxx' });
await call('GET', '/orders?status=bogus');
await call('GET', '/reports/daily?date=2026-02-30');
await call('GET', '/reports/daily?date=2026-13-01');
await call('GET', '/reports/daily?date=abcd');
await call('GET', '/inventory/movements?limit=abc');
await call('GET', '/inventory/movements?type=bogus');
await call('GET', '/inventory/expiring?days=-5');
await call('GET', '/inventory/recipes/' + randomUUID());
await call('PUT', '/inventory/recipes/' + randomUUID(), { items: [] });

// ---------- catalog ----------
const c1 = await call('POST', '/catalog/products', { name: 'probe' + sfx, priceSatang: 100, categoryId: randomUUID() });
expect('product with nonexistent category should be 400', c1.s === 400, `got ${c1.s}`);
const bc = 'BC' + sfx;
const pa = await call('POST', '/catalog/products', { name: 'probeA' + sfx, priceSatang: 100, barcode: bc });
const pb = await call('POST', '/catalog/products', { name: 'probeB' + sfx, priceSatang: 100, barcode: bc });
expect('duplicate barcode should be 409/400', pb.s === 409 || pb.s === 400, `got ${pb.s}`);
const huge = await call('POST', '/catalog/products', { name: 'probeH' + sfx, priceSatang: 99999999999 });
expect('huge price should be 400', huge.s === 400, `got ${huge.s}`);
const neg = await call('POST', '/catalog/products', { name: 'probeN' + sfx, priceSatang: -1 });
expect('negative price 400', neg.s === 400);
const clearCat = await call('PATCH', `/catalog/products/${pa.j.id}`, { categoryId: null });
expect('clear category (null) should be allowed', clearCat.s === 200, `got ${clearCat.s} ${JSON.stringify(clearCat.j)}`);
const dupCat = await call('POST', '/catalog/categories', { name: 'cat' + sfx });
await call('POST', '/catalog/categories', { name: 'cat' + sfx });

// ---------- tables ----------
await call('POST', '/tables', { name: 'TP' + sfx });
const dupT = await call('POST', '/tables', { name: 'TP' + sfx });
expect('duplicate table name should be 409/400', dupT.s === 409 || dupT.s === 400, `got ${dupT.s}`);
const tables = (await call('GET', '/tables')).j;
const freeT = tables.find((t) => !t.openOrder);
const o = await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: freeT.id, items: [{ productId: p.id, qty: 1 }] });
const deact = await call('PATCH', `/tables/${freeT.id}`, { active: false });
expect('deactivating table with open bill should be rejected', deact.s === 400 || deact.s === 409, `got ${deact.s}`);
await call('PATCH', `/tables/${freeT.id}`, { active: true });

// order on inactive product
const off = await call('POST', '/catalog/products', { name: 'off' + sfx, priceSatang: 500, active: false });
const addOff = await call('POST', `/orders/${o.j.id}/items`, { items: [{ productId: off.j.id, qty: 1 }] });
expect('adding inactive product should 400', addOff.s === 400, `got ${addOff.s}`);

// pay with mixed: cash received < amount
const payBad = await call('POST', `/orders/${o.j.id}/pay`, { payments: [{ method: 'cash', amountSatang: o.j.totalSatang, receivedSatang: 1 }] });
expect('cash received < amount 400', payBad.s === 400);
// pay with discount == subtotal (total 0)
const pay0 = await call('POST', `/orders/${o.j.id}/pay`, { discountSatang: o.j.totalSatang, payments: [{ method: 'cash', amountSatang: 1 }] });
expect('discount=subtotal should be 400 not 5xx', pay0.s === 400, `got ${pay0.s}`);
// all items voided then pay
const it0 = o.j.items[0];
await call('POST', `/orders/${o.j.id}/items/${it0.id}/void`, { reason: 'test' });
const payEmpty = await call('POST', `/orders/${o.j.id}/pay`, { payments: [{ method: 'cash', amountSatang: 1 }] });
expect('pay empty bill 400', payEmpty.s === 400);
await call('POST', `/orders/${o.j.id}/void`, { reason: 'cleanup' });

// ---------- shifts race ----------
const cur = (await call('GET', '/shifts/current')).j;
if (cur) await call('POST', '/shifts/close', { closingCashSatang: 0 });
const opens = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/shifts/open', { openingCashSatang: 1000 })));
const okOpens = opens.filter((r) => r.s === 201).length;
expect('concurrent shift open should create exactly one', okOpens === 1, `created ${okOpens}`);

// ---------- concurrent table open ----------
const t3 = (await call('GET', '/tables')).j.find((t) => !t.openOrder);
const tOpens = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: t3.id, items: [{ productId: p.id, qty: 1 }] })));
expect('concurrent table open → exactly one bill', tOpens.filter((r) => r.s === 201).length === 1, tOpens.map((r) => r.s).join(','));
const open3 = tOpens.find((r) => r.s === 201);
// concurrent pay same bill
const pays = await Promise.all(Array.from({ length: 4 }, () => call('POST', `/orders/${open3.j.id}/pay`, { payments: [{ method: 'card', amountSatang: open3.j.totalSatang }] })));
expect('concurrent pay → exactly one success', pays.filter((r) => r.s === 200).length === 1, pays.map((r) => r.s).join(','));
const after = (await call('GET', `/orders/${open3.j.id}`)).j;
expect('only one payment row', after.payments.length === 1, `${after.payments.length}`);

// ---------- sync edge ----------
const syncHugeDate = await call('POST', '/sync/orders', { orders: [{ clientId: randomUUID(), type: 'takeaway', occurredAt: '1999-01-01T00:00:00Z', items: [{ name: 'x', unitPriceSatang: 100, qty: 1 }], payments: [{ method: 'cash', amountSatang: 100 }] }] });
expect('sync with very old occurredAt should be rejected', syncHugeDate.j?.results?.[0]?.status === 'rejected', JSON.stringify(syncHugeDate.j));
const syncNoProd = await call('POST', '/sync/orders', { orders: [{ clientId: randomUUID(), type: 'takeaway', occurredAt: new Date().toISOString(), items: [{ productId: randomUUID(), name: 'ghost', unitPriceSatang: 100, qty: 1 }], payments: [{ method: 'cash', amountSatang: 100 }] }] });
expect('sync unknown product handled', syncNoProd.s === 200);
// big batch body size
const bigItems = Array.from({ length: 100 }, (_, i) => ({ productId: p.id, name: p.name + ' '.repeat(150), unitPriceSatang: p.priceSatang, qty: 1, note: 'n'.repeat(190) }));
const bigBatch = Array.from({ length: 50 }, () => ({ clientId: randomUUID(), type: 'takeaway', occurredAt: new Date().toISOString(), items: bigItems, payments: [{ method: 'cash', amountSatang: p.priceSatang * 100 }] }));
const big = await call('POST', '/sync/orders', { orders: bigBatch });
expect('max-size sync batch accepted (body limit)', big.s === 200, `got ${big.s} ${JSON.stringify(big.j)?.slice(0, 100)}`);

// ---------- users / auth ----------
const uname = 'probe' + sfx;
await call('POST', '/users', { username: uname, password: 'password123', displayName: 'P', role: 'cashier' });
const dupU = await call('POST', '/users', { username: uname, password: 'password123', displayName: 'P', role: 'cashier' });
expect('dup username 400', dupU.s === 400);
const cl = await call('POST', '/auth/login', { username: uname, password: 'password123' });
const cashierToken = cl.j.token;
const users = (await call('GET', '/users')).j;
const cu = users.find((u) => u.username === uname);
await call('PATCH', `/users/${cu.id}`, { active: false });
token = cashierToken;
const afterDeact = await call('GET', '/catalog/menu');
expect('deactivated user token must stop working', afterDeact.s === 401, `got ${afterDeact.s}`);
token = owner;
await call('PATCH', `/users/${cu.id}`, { active: true, password: 'newpassword1' });
token = cashierToken;
const afterPw = await call('GET', '/catalog/menu');
expect('old token after password change must stop working', afterPw.s === 401, `got ${afterPw.s}`);
token = owner;
// brute force
let locked = false;
for (let i = 0; i < 12; i++) {
  const r = await call('POST', '/auth/login', { username: uname, password: 'wrong' + i });
  if (r.s === 429) locked = true;
}
expect('login brute force throttled', locked);

// ---------- inventory edge ----------
const ing = await call('POST', '/inventory/ingredients', { name: 'pi' + sfx, unit: 'g' });
const bigRecv = await call('POST', '/inventory/receive', { items: [{ ingredientId: ing.j.id, qty: 1000, totalCostSatang: 5_000_000_000 }] });
expect('large receive cost no 5xx', bigRecv.s < 500, `got ${bigRecv.s}`);
const dupIng = await call('PATCH', `/inventory/ingredients/${ing.j.id}`, { name: 'ข้าวสาร' });
expect('rename ingredient to existing name → 409/400', dupIng.s === 409 || dupIng.s === 400, `got ${dupIng.s}`);
const unitChange = await call('PATCH', `/inventory/ingredients/${ing.j.id}`, { unit: 'pcs' });
expect('unit change rejected', unitChange.s === 400);
const inactive = await call('PATCH', `/inventory/ingredients/${ing.j.id}`, { active: false });
const recvInactive = await call('POST', '/inventory/receive', { items: [{ ingredientId: ing.j.id, qty: 1, totalCostSatang: 1 }] });
expect('receive inactive ingredient 400', recvInactive.s === 400);
const cnt = await call('POST', '/inventory/counts', { lines: [] });
expect('empty count 400', cnt.s === 400);
const badExp = await call('POST', '/inventory/receive', { items: [{ ingredientId: randomUUID(), qty: 1, totalCostSatang: 1, expiryDate: 'notadate' }] });
expect('bad expiry 400', badExp.s === 400);
const tr = await call('POST', '/inventory/transfer', { toBranchId: randomUUID(), items: [{ ingredientId: randomUUID(), qty: 1 }] });
expect('transfer to unknown branch 404/400', tr.s === 404 || tr.s === 400, `got ${tr.s}`);

// cashier access matrix
token = (await call('POST', '/auth/login', { username: uname, password: 'newpassword1' })).j?.token ?? cashierToken;
for (const [m, path, body] of [
  ['POST', '/catalog/products', { name: 'x', priceSatang: 1 }],
  ['POST', '/tables', { name: 'x' }],
  ['POST', '/branches', { code: 'ZZ', name: 'x' }],
  ['PATCH', '/branches/me', { name: 'hacked' }],
  ['GET', '/inventory/levels'],
  ['POST', '/inventory/receive', { items: [] }],
  ['GET', '/reports/daily'],
  ['GET', '/users'],
]) {
  const r = await call(m, path, body);
  expect(`cashier ${m} ${path} must be 403`, r.s === 403 || r.s === 401, `got ${r.s}`);
}
token = owner;

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log('EDGE TEST PASSED');
