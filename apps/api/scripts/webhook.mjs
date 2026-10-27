/**
 * ทดสอบ webhook รับแจ้งเงินเข้า (ต้อง start API ด้วย PAYMENT_PROVIDER=webhook PAYMENT_WEBHOOK_SECRET=<secret> TRUST_PROXY=1)
 *   API_URL=http://localhost:3000/api PAYMENT_WEBHOOK_SECRET=<secret> node scripts/webhook.mjs
 */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
assert.ok(SECRET, 'ต้องตั้ง PAYMENT_WEBHOOK_SECRET');
let token = '';
const ok = (m) => console.log('✓', m);

async function call(method, path, body, expect) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const sign = (ts, raw) => createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
async function hook(payload, { ts = Date.now(), sig, raw } = {}, expect) {
  const body = raw ?? JSON.stringify(payload);
  const res = await fetch(`${API}/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-timestamp': String(ts), 'x-signature': sig ?? sign(ts, body) },
    body,
  });
  const text = await res.text();
  assert.equal(res.status, expect, `webhook → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

token = (await call('POST', '/auth/login', { username: 'owner', password: process.env.OWNER_PASSWORD ?? 'ChangeMe!2026' }, 201)).token;
if (!(await call('GET', '/shifts/current'))) await call('POST', '/shifts/open', { openingCashSatang: 100000 });
await call('PATCH', '/branches/me', { promptpayId: '0812345678' }, 200);
const cfg = await call('GET', '/payments/config');
assert.equal(cfg.provider, 'webhook');
const menu = await call('GET', '/catalog/menu');
const p = menu.products[0];
// สร้างโต๊ะของตัวเองสำหรับการทดสอบ (ไม่พึ่งโต๊ะว่างในฐานข้อมูล)
const stamp = Date.now() % 1000000;
const free = [];
for (let i = 0; i < 4; i++) free.push(await call('POST', '/tables', { name: `W${stamp}${i}`, seats: 2 }, 201));

async function newIntent(table, qty = 1) {
  const o = await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: table.id, items: [{ productId: p.id, qty }] }, 201);
  const i = await call('POST', `/orders/${o.id}/payment-intents`, {}, 201);
  return { o, i };
}

// simulate ใช้ไม่ได้ในโหมด webhook
const a = await newIntent(free[0]);
await call('POST', `/payment-intents/${a.i.id}/simulate-paid`, undefined, 503);

// ลายเซ็น / เวลา / รูปแบบ
const good = { intentId: a.i.id, txnId: `TX-${randomUUID()}`, amountSatang: a.i.amountSatang, status: 'paid' };
await hook(good, { sig: 'deadbeef' }, 401);
{
  // ลายเซ็นถูกต้อง แต่เปลี่ยนตัวอักษรสุดท้ายเป็นค่าอื่นเสมอ (กันกรณีบังเอิญตรงกับค่าเดิม)
  const ts = Date.now();
  const real = sign(ts, JSON.stringify(good));
  await hook(good, { ts, sig: real.slice(0, -1) + (real.endsWith('0') ? '1' : '0') }, 401);
}
await hook(good, { ts: Date.now() - 10 * 60_000 }, 401);
const raw = JSON.stringify(good);
{
  const ts = Date.now();
  await hook(good, { ts, raw: raw.replace(String(good.amountSatang), '1'), sig: sign(ts, raw) }, 401);
}
assert.equal((await call('GET', `/orders/${a.o.id}`)).status, 'open', 'ลายเซ็นผิดต้องไม่ปิดบิล');
ok('ลายเซ็นผิด/เนื้อหาถูกแก้/timestamp เก่า → 401 และไม่ปิดบิล');
await hook({ ...good, amountSatang: 'abc' }, {}, 400);
await hook({ ...good, intentId: 'nope' }, {}, 400);
await hook({ ...good, txnId: '' }, {}, 400);
await hook({ ...good, intentId: randomUUID() }, {}, 404);
assert.deepEqual(await hook({ ...good, status: 'failed' }, {}, 200), { result: 'ignored' });
ok('ข้อมูลผิดรูปแบบ → 400, intent ไม่มี → 404, status ไม่ใช่ paid → ignored');

// สำเร็จ + ส่งซ้ำ (gateway retry)
const r1 = await hook(good, {}, 200);
assert.equal(r1.result, 'paid');
const o1 = await call('GET', `/orders/${a.o.id}`);
assert.equal(o1.status, 'paid');
assert.equal(o1.payments[0].reference, good.txnId);
const r2 = await hook(good, {}, 200);
assert.equal(r2.result, 'duplicate');
assert.equal((await call('GET', `/orders/${a.o.id}`)).payments.length, 1);
ok('เงินเข้า → ปิดบิล (อ้างอิง txnId), gateway ยิงซ้ำ → duplicate ไม่ซ้อน');

// ยิงพร้อมกัน 8 ครั้ง (retry storm) → จ่ายครั้งเดียว
const b = await newIntent(free[1]);
const storm = { intentId: b.i.id, txnId: `TX-${randomUUID()}`, amountSatang: b.i.amountSatang, status: 'paid' };
const outs = await Promise.all(Array.from({ length: 8 }, () => hook(storm, {}, 200).then((r) => r, (e) => ({ error: String(e) }))));
assert.equal(outs.filter((r) => r.result === 'paid').length, 1, JSON.stringify(outs));
assert.ok(outs.every((r) => r.result === 'paid' || r.result === 'duplicate'), JSON.stringify(outs));
const ob = await call('GET', `/orders/${b.o.id}`);
assert.equal(ob.status, 'paid');
assert.equal(ob.payments.length, 1);
ok('webhook ยิงซ้ำพร้อมกัน 8 ครั้ง → ปิดบิลครั้งเดียว');

// ยอดไม่ตรง (โอนขาด/เกิน) → review ไม่ปิดบิล
const c = await newIntent(free[2]);
const short = await hook({ intentId: c.i.id, txnId: `TX-${randomUUID()}`, amountSatang: c.i.amountSatang - 1, status: 'paid' }, {}, 200);
assert.equal(short.result, 'review');
assert.equal((await call('GET', `/orders/${c.o.id}`)).status, 'open');
assert.equal((await call('GET', `/payment-intents/${c.i.id}`)).status, 'review');
const reviews = await call('GET', '/payment-intents');
assert.ok(reviews.some((r) => r.id === c.i.id && r.note.includes('ไม่ตรง')));
ok('โอนไม่ครบยอด → review ไม่ปิดบิล');

// txnId เดียวกันแต่คนละ intent → ปฏิเสธ
const d = await newIntent(free[3]);
await hook({ intentId: d.i.id, txnId: good.txnId, amountSatang: d.i.amountSatang, status: 'paid' }, {}, 409);
assert.equal((await call('GET', `/orders/${d.o.id}`)).status, 'open');
ok('txnId ซ้ำข้าม intent → 409 ไม่ปิดบิล');

console.log('\nWEBHOOK TEST PASSED');
