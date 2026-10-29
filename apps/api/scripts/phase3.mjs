/**
 * ทดสอบ Phase 3 end-to-end: สั่งผ่าน QR, จอครัว, คิว, ยืนยันการจ่ายอัตโนมัติ (โหมด PAYMENT_PROVIDER=mock)
 *   API_URL=http://localhost:3000/api node scripts/phase3.mjs
 * ต้อง start API ด้วย TRUST_PROXY=1 PAYMENT_PROVIDER=mock (สคริปต์ใช้ X-Forwarded-For แยก IP ต่อการทดสอบ เพื่อไม่ชนตัวจำกัดอัตรา)
 * สร้างข้อมูลทดสอบจริง ห้ามรันกับ production
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const SHOP = process.env.SHOP ?? 'main';
let token = '';
let ip = '10.0.0.1';
const rnd = () => `10.${(Math.random() * 250 + 1) | 0}.${(Math.random() * 250 + 1) | 0}.${(Math.random() * 250 + 1) | 0}`;

async function call(method, path, body, expect, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${path} → ${res.status} ${text}`);
  else assert.ok(res.ok, `${method} ${path} → ${res.status} ${text}`);
  return json;
}
const pub = (method, path, body, expect) => {
  const t = token;
  token = '';
  return call(method, path, body, expect).finally(() => (token = t));
};
const ok = (m) => console.log('✓', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sum = (levels) => levels.reduce((s, l) => s + l.qty, 0);

// ---------- setup ----------
const owner = (await call('POST', '/auth/login', { tenant: SHOP, username: 'owner', password: process.env.OWNER_PASSWORD ?? 'ChangeMe!2026' })).token;
token = owner;
const uname = `p3cash${Date.now() % 100000}`;
await call('POST', '/users', { username: uname, password: 'cashier-pass-1', displayName: 'แคชเชียร์ P3', role: 'cashier' });
const cashier = (await call('POST', '/auth/login', { tenant: SHOP, username: uname, password: 'cashier-pass-1' })).token;
if (!(await call('GET', '/shifts/current'))) await call('POST', '/shifts/open', { openingCashSatang: 100000 });
const br = await call('PATCH', '/branches/me', { promptpayId: '0812345678', qrOrdering: true, qrRequireApproval: true }, 200);
assert.equal(br.qrOrdering, true);
const menu = await call('GET', '/catalog/menu');
const costing = await call('GET', '/inventory/costing');
const withRecipe = menu.products.find((p) => costing.find((c) => c.productId === p.id)?.hasRecipe);
const [p1, p2] = menu.products.filter((p) => p !== withRecipe);
assert.ok(withRecipe && p1 && p2);
async function newTable(name) {
  const prev = token;
  token = owner;
  try {
    return await newTableAsOwner(name);
  } finally {
    token = prev;
  }
}
async function newTableAsOwner(name) {
  const t = await call('POST', '/tables', { name: `${name}${Date.now() % 100000}${(Math.random() * 99) | 0}`, seats: 2 }, 201);
  assert.equal(t.qrToken, undefined, 'POST /tables ต้องไม่คืนโทเค็น');
  const qr = (await call('GET', '/tables/qr')).find((x) => x.id === t.id);
  assert.match(qr.qrToken, /^[0-9a-f]{32}$/);
  return { ...t, qrToken: qr.qrToken };
}

// ---------- 1. สั่งผ่าน QR (ต้องยืนยัน) ----------
ip = rnd();
const T = await newTable('Q');
token = cashier;
const listed = await call('GET', '/tables');
assert.ok(listed.length && listed.every((t) => t.qrToken === undefined), 'รายการโต๊ะของพนักงานต้องไม่มีโทเค็น QR');
await call('GET', '/tables/qr', undefined, 403);
await call('POST', `/tables/${T.id}/rotate-qr`, undefined, 403);
token = owner;
ok('โทเค็น QR ดูได้เฉพาะผู้จัดการ');

await pub('GET', '/public/t/not-a-token', undefined, 404);
await pub('GET', `/public/t/${'0'.repeat(32)}`, undefined, 404);
const page = await pub('GET', `/public/t/${T.qrToken}`, undefined, 200);
assert.equal(page.order, null);
assert.equal(page.table.name, T.name);
assert.ok(page.menu.products.length >= 3);
const leaked = Object.keys(page.menu.products[0]).sort().join();
assert.equal(leaked, 'categoryId,id,name,priceSatang', `เมนูสาธารณะต้องไม่มี sku/barcode: ${leaked}`);
assert.equal(page.canPay, true);
ok('หน้าลูกค้า: token ผิด → 404, เมนูไม่รั่ว sku/barcode');

const sub1 = randomUUID();
const body1 = { submissionId: sub1, items: [{ productId: p1.id, qty: 2, note: 'ไม่เผ็ด' }, { productId: p2.id, qty: 1 }] };
const s1 = await pub('POST', `/public/t/${T.qrToken}/order`, body1, 200);
assert.equal(s1.requireApproval, true);
assert.equal(s1.order.totalSatang, 0, 'รายการรอยืนยันต้องยังไม่นับยอด');
assert.ok(s1.order.items.every((i) => i.status === 'pending'));
const again1 = await pub('POST', `/public/t/${T.qrToken}/order`, body1, 200);
assert.equal(again1.order.items.length, 2, 'ส่งซ้ำด้วย submissionId เดิมต้องไม่เกิดรายการซ้ำ');
ok('ลูกค้าสั่ง → รอยืนยัน (ไม่นับยอด) และส่งซ้ำไม่ซ้ำ');

token = cashier;
const pend = await call('GET', '/orders/pending');
const mine = pend.find((g) => g.tableName === T.name);
assert.equal(mine.items.length, 2);
let kitchen = await call('GET', '/kitchen');
assert.ok(!kitchen.some((k) => k.orderId === mine.orderId), 'รายการรอยืนยันต้องยังไม่ขึ้นจอครัว');
await call('POST', `/orders/${mine.orderId}/pay`, { payments: [{ method: 'cash', amountSatang: 100 }] }, 400);
const intentNo = await call('POST', `/orders/${mine.orderId}/payment-intents`, {}, 400);
ok('มีรายการรอยืนยัน → ไม่ขึ้นครัว, จ่าย/สร้าง QR จ่ายไม่ได้');

const approved = await call('POST', `/orders/${mine.orderId}/pending/approve`, {}, 200);
assert.equal(approved.totalSatang, p1.priceSatang * 2 + p2.priceSatang);
assert.ok(approved.items.every((i) => i.status === 'active'));
kitchen = await call('GET', '/kitchen');
const ticket = kitchen.find((k) => k.orderId === mine.orderId);
assert.equal(ticket.items.length, 2);
assert.ok(ticket.items.every((i) => i.status === 'new' && i.source === 'customer'));
ok('พนักงานยืนยัน → เข้าบิล คิดยอด และขึ้นจอครัว');

// ครัว: ลำดับสถานะ
const first = ticket.items[0];
await call('PATCH', `/kitchen/items/${first.id}`, { status: 'preparing' }, 200);
await call('PATCH', `/kitchen/items/${first.id}`, { status: 'bogus' }, 400);
await call('PATCH', `/kitchen/items/${randomUUID()}`, { status: 'ready' }, 404);
let page2 = await pub('GET', `/public/t/${T.qrToken}`, undefined, 200);
assert.ok(page2.order.items.some((i) => i.kitchenStatus === 'preparing'), 'ลูกค้าต้องเห็นสถานะการทำอาหาร');
await call('POST', `/kitchen/orders/${mine.orderId}/status`, { status: 'ready' }, 200);
await call('POST', `/kitchen/orders/${mine.orderId}/status`, { status: 'new' }, 400);
kitchen = await call('GET', '/kitchen');
assert.ok(kitchen.find((k) => k.orderId === mine.orderId).items.every((i) => i.status === 'ready'));
await call('POST', `/kitchen/orders/${mine.orderId}/status`, { status: 'served' }, 200);
kitchen = await call('GET', '/kitchen');
assert.ok(!kitchen.some((k) => k.orderId === mine.orderId), 'เสิร์ฟครบแล้วต้องหายจากจอครัว');
ok('จอครัว: preparing → ready → served, สถานะถึงลูกค้า, ค่าผิด → 400');

// ปฏิเสธ
await pub('POST', `/public/t/${T.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p2.id, qty: 5 }] }, 200);
const rej = await call('POST', `/orders/${mine.orderId}/pending/reject`, { reason: 'หมดแล้ว' }, 200);
assert.equal(rej.items.filter((i) => i.status === 'void').length, 1);
assert.equal(rej.totalSatang, approved.totalSatang);
ok('ปฏิเสธรายการลูกค้า → void ยอดไม่เปลี่ยน');

// ---------- 2. validation / abuse ----------
const bad = (body, why) => pub('POST', `/public/t/${T.qrToken}/order`, body, 400).then(() => ok(`ปฏิเสธ: ${why}`));
await bad({ submissionId: randomUUID(), items: [{ productId: p1.id, qty: 21 }] }, 'qty > 20');
await bad({ submissionId: randomUUID(), items: [{ productId: p1.id, qty: 0 }] }, 'qty = 0');
await bad({ submissionId: randomUUID(), items: [] }, 'ไม่มีรายการ');
await bad({ submissionId: randomUUID(), items: [{ productId: randomUUID(), qty: 1 }] }, 'สินค้าไม่มีจริง');
await bad({ submissionId: randomUUID(), items: [{ productId: p1.id, qty: 1, priceSatang: 1 }] }, 'ส่งราคามาเอง (field เกิน)');
await bad({ submissionId: 'x', items: [{ productId: p1.id, qty: 1 }] }, 'submissionId ไม่ใช่ uuid');
await bad({ submissionId: randomUUID(), items: Array.from({ length: 21 }, () => ({ productId: p1.id, qty: 1 })) }, 'เกิน 20 บรรทัด');
// รายการรอยืนยันค้างเกินเพดาน (40)
const T2 = await newTable('F');
let ipFlood = rnd();
ip = ipFlood;
for (let i = 0; i < 2; i++) await pub('POST', `/public/t/${T2.qrToken}/order`, { submissionId: randomUUID(), items: Array.from({ length: 20 }, () => ({ productId: p1.id, qty: 1 })) }, 200);
await pub('POST', `/public/t/${T2.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p1.id, qty: 1 }] }, 400);
ok('เพดานรายการรอยืนยัน 40 บรรทัดต่อบิล');
// limiter ต่อโต๊ะ: 15 ครั้ง/10 นาที
const T3 = await newTable('L');
let got429 = false;
for (let i = 0; i < 20 && !got429; i++) {
  ip = rnd(); // ต่าง IP — ให้ตัวจำกัดต่อโต๊ะทำงาน
  const t = token; token = '';
  const r = await fetch(`${API}/public/t/${T3.qrToken}/order`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ submissionId: randomUUID(), items: [{ productId: p1.id, qty: 1 }] }) });
  token = t;
  if (r.status === 429) got429 = true;
  else assert.equal(r.status, 200);
  if (i === 14 && !got429) { /* ครั้งที่ 16 ต้องถูกกัน */ }
}
assert.ok(got429, 'ต้องโดน 429 เมื่อสั่งถี่เกินต่อโต๊ะ');
ok('limiter: สั่งถี่เกินต่อโต๊ะ → 429');

// ---------- 3. สั่งพร้อมกัน (บิลโต๊ะเดียว) ----------
ip = rnd();
const T4 = await newTable('C');
const results = await Promise.all(
  Array.from({ length: 10 }, () => pub('POST', `/public/t/${T4.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p2.id, qty: 1 }] }).then((r) => r, (e) => e)),
);
assert.ok(results.every((r) => r.ok === true), `ทุกคำขอต้องสำเร็จ: ${JSON.stringify(results.filter((r) => !r.ok)).slice(0, 300)}`);
token = cashier;
const tbl = (await call('GET', '/tables')).find((t) => t.id === T4.id);
assert.ok(tbl.openOrder);
const ord = await call('GET', `/orders/${tbl.openOrder.id}`);
assert.equal(ord.items.length, 10);
const allOpen = await call('GET', '/orders?status=open');
assert.equal(allOpen.filter((o) => o.tableId === T4.id).length, 1, 'ต้องมีบิลเปิดเดียวต่อโต๊ะ');
ok('ลูกค้าสั่งพร้อมกัน 10 ครั้ง → บิลเดียว รายการครบ ไม่ซ้ำ');
// ลูกค้าสั่งขณะพนักงานเปิดบิลโต๊ะเดียวกัน
const T5 = await newTable('R');
token = owner;
const raceCalls = [
  call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: T5.id, items: [{ productId: p1.id, qty: 1 }] }).then((r) => r, (e) => e),
  pub('POST', `/public/t/${T5.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p2.id, qty: 1 }] }).then((r) => r, (e) => e),
];
await Promise.all(raceCalls);
const open5 = (await call('GET', '/orders?status=open')).filter((o) => o.tableId === T5.id);
assert.equal(open5.length, 1);
ok('พนักงานเปิดบิล/ลูกค้าสั่งพร้อมกัน → บิลเดียว');

// ---------- 4. ตั้งค่าร้าน ----------
const T6 = await newTable('S');
token = owner;
await call('PATCH', '/branches/me', { qrRequireApproval: false }, 200);
const auto = await pub('POST', `/public/t/${T6.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p1.id, qty: 2 }] }, 200);
assert.equal(auto.order.totalSatang, p1.priceSatang * 2);
assert.ok(auto.order.items.every((i) => i.status === 'active'));
kitchen = await call('GET', '/kitchen');
assert.ok(kitchen.some((k) => k.tableName === T6.name), 'ไม่ต้องยืนยัน → เข้าครัวทันที');
ok('ปิดโหมดยืนยัน → เข้าบิลและครัวทันที');
await call('PATCH', '/branches/me', { qrOrdering: false }, 200);
await pub('POST', `/public/t/${T6.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p1.id, qty: 1 }] }, 400);
await pub('GET', `/public/t/${T6.qrToken}`, undefined, 400);
await call('PATCH', '/branches/me', { qrOrdering: true, qrRequireApproval: true }, 200);
ok('ปิดรับออเดอร์ QR → 400');
const rot = await call('POST', `/tables/${T6.id}/rotate-qr`, undefined, 201);
assert.notEqual(rot.qrToken, T6.qrToken);
await pub('GET', `/public/t/${T6.qrToken}`, undefined, 404);
await pub('GET', `/public/t/${rot.qrToken}`, undefined, 200);
ok('หมุน QR: โทเค็นเก่าใช้ไม่ได้ทันที');

// ---------- 5. จ่าย PromptPay อัตโนมัติ (mock) ----------
const cfg = await call('GET', '/payments/config');
assert.equal(cfg.provider, 'mock');
const T7 = await newTable('P');
token = owner;
const o7 = await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: T7.id, items: [{ productId: withRecipe.id, qty: 2 }] }, 201);
const stockBefore = sum(await call('GET', '/inventory/levels'));
const i1 = await call('POST', `/orders/${o7.id}/payment-intents`, {}, 201);
assert.equal(i1.amountSatang, o7.totalSatang);
assert.equal(i1.status, 'pending');
assert.ok(i1.qrPayload.includes((o7.totalSatang / 100).toFixed(2)) && i1.qrPayload.includes('0066812345678'));
const i1b = await call('POST', `/orders/${o7.id}/payment-intents`, {}, 201);
assert.equal(i1b.id, i1.id, 'กดซ้ำยอดเดิมต้องได้ QR เดิม');
token = cashier;
await call('POST', `/payment-intents/${i1.id}/simulate-paid`, undefined, 403);
await call('POST', `/orders/${o7.id}/payment-intents`, { discountSatang: 100 }, 403);
token = owner;
ok('สร้าง QR ตามยอดบิล (ยอด/PromptPay ID ถูก), ใช้ซ้ำ, cashier จำลองจ่าย/ให้ส่วนลดไม่ได้');

// บิลเปลี่ยน → QR เก่าถูกยกเลิก
await call('POST', `/orders/${o7.id}/items`, { items: [{ productId: p1.id, qty: 1 }] }, 201);
assert.equal((await call('GET', `/payment-intents/${i1.id}`)).status, 'cancelled');
// เงินเข้า QR ที่ถูกยกเลิก → ไม่ปิดบิลมั่ว ส่งไปให้ตรวจ
const rv = await call('POST', `/payment-intents/${i1.id}/simulate-paid`, undefined, 200);
assert.equal(rv.result, 'review');
assert.equal((await call('GET', `/orders/${o7.id}`)).status, 'open');
const reviewList = await call('GET', '/payment-intents');
assert.ok(reviewList.some((r) => r.id === i1.id && r.status === 'review'));
const audits = await call('GET', '/reports/audit');
assert.ok(audits.some((a) => a.action === 'payment.review' && a.detail.orderNo === o7.orderNo), 'ต้องมี audit payment.review');
ok('บิลเปลี่ยนหลังสร้าง QR → QR ยกเลิก, เงินเข้าแล้วไม่ปิดบิลมั่ว → review + audit');

// สร้างใหม่แล้วจ่ายสำเร็จ
const cur = await call('GET', `/orders/${o7.id}`);
const i2 = await call('POST', `/orders/${o7.id}/payment-intents`, {}, 201);
assert.equal(i2.amountSatang, cur.totalSatang);
assert.notEqual(i2.id, i1.id);
const paidR = await call('POST', `/payment-intents/${i2.id}/simulate-paid`, undefined, 200);
assert.equal(paidR.result, 'paid');
const o7p = await call('GET', `/orders/${o7.id}`);
assert.equal(o7p.status, 'paid');
assert.equal(o7p.payments.length, 1);
assert.equal(o7p.payments[0].method, 'promptpay');
assert.equal(o7p.payments[0].amountSatang, cur.totalSatang);
assert.equal((await call('GET', `/payment-intents/${i2.id}`)).status, 'paid');
assert.ok(sum(await call('GET', '/inventory/levels')) < stockBefore, 'ปิดบิลอัตโนมัติต้องหักสต็อกตามสูตร');
const dup = await call('POST', `/payment-intents/${i2.id}/simulate-paid`, undefined, 200);
assert.equal(dup.result, 'review', 'จ่ายซ้ำ QR ที่จ่ายแล้ว → ต้องไปตรวจ/คืนเงิน');
assert.equal((await call('GET', `/orders/${o7.id}`)).payments.length, 1, 'ห้ามมี payment เพิ่ม');
ok('เงินเข้า → ปิดบิลอัตโนมัติ + หักสต็อก, จ่ายซ้ำไม่ซ้อน');

// จ่ายเงินสดแทน → QR ที่ค้างถูกยกเลิก
const T8 = await newTable('K');
const o8 = await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: T8.id, items: [{ productId: p1.id, qty: 1 }] }, 201);
const i8 = await call('POST', `/orders/${o8.id}/payment-intents`, {}, 201);
await call('POST', `/orders/${o8.id}/pay`, { payments: [{ method: 'cash', amountSatang: o8.totalSatang }] }, 200);
assert.equal((await call('GET', `/payment-intents/${i8.id}`)).status, 'cancelled');
const late = await call('POST', `/payment-intents/${i8.id}/simulate-paid`, undefined, 200);
assert.equal(late.result, 'review');
ok('จ่ายเงินสดไปแล้ว → QR ยกเลิก, เงินโอนมาทีหลังไป review');

// ส่วนลดที่ผู้จัดการอนุมัติตอนสร้าง QR ถูกใช้ตอนปิดบิล
const T9 = await newTable('D');
const o9 = await call('POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: T9.id, items: [{ productId: p2.id, qty: 2 }] }, 201);
const i9 = await call('POST', `/orders/${o9.id}/payment-intents`, { discountSatang: 1000 }, 201);
assert.equal(i9.amountSatang, o9.totalSatang - 1000);
await call('POST', `/payment-intents/${i9.id}/simulate-paid`, undefined, 200);
const o9p = await call('GET', `/orders/${o9.id}`);
assert.equal(o9p.status, 'paid');
assert.equal(o9p.discountSatang, 1000);
await call('POST', `/orders/${o9.id}/payment-intents`, {}, 400); // บิลปิดแล้ว
ok('ส่วนลดที่อนุมัติไว้ตอนสร้าง QR ถูกใช้ตอนปิดบิล');

// ลูกค้าจ่ายเองที่โต๊ะ
ip = rnd();
const T10 = await newTable('M');
token = owner;
await pub('POST', `/public/t/${T10.qrToken}/pay`, undefined, 400); // ยังไม่มีบิล
await call('PATCH', '/branches/me', { qrRequireApproval: false }, 200);
await pub('POST', `/public/t/${T10.qrToken}/order`, { submissionId: randomUUID(), items: [{ productId: p1.id, qty: 1 }] }, 200);
const cp = await pub('POST', `/public/t/${T10.qrToken}/pay`, undefined, 200);
assert.ok(cp.qrPayload.startsWith('000201') && cp.amountSatang === p1.priceSatang);
assert.equal((await pub('GET', `/public/t/${T10.qrToken}/pay/${cp.id}`, undefined, 200)).status, 'pending');
await pub('GET', `/public/t/${T2.qrToken}/pay/${cp.id}`, undefined, 404); // intent ของโต๊ะอื่น
await call('POST', `/payment-intents/${cp.id}/simulate-paid`, undefined, 200);
assert.equal((await pub('GET', `/public/t/${T10.qrToken}/pay/${cp.id}`, undefined, 200)).status, 'paid');
await call('PATCH', '/branches/me', { qrRequireApproval: true }, 200);
ok('ลูกค้าจ่ายเอง: ได้ QR ตามบิล, เห็นสถานะ paid, ดูของโต๊ะอื่นไม่ได้');

// webhook ปิดอยู่ในโหมด mock
await pub('POST', '/payments/webhook', { intentId: randomUUID(), txnId: 'x', amountSatang: 1, status: 'paid' }, 503);
ok('webhook ปิดเมื่อไม่ได้ตั้งโหมด webhook');

// ---------- 6. คิว ----------
token = cashier;
ip = rnd();
const q1 = await call('POST', '/queue', { partySize: 2, name: 'คุณเอ' }, 201);
assert.match(q1.code, /^Q\d{3}$/);
await call('POST', '/queue', { partySize: 0 }, 400);
await call('POST', '/queue', { partySize: 31 }, 400);
await call('POST', '/queue', { partySize: 2, phone: 'abc' }, 400);
const c1 = await pub('POST', `/public/queue/${SHOP}/MAIN`, { partySize: 4, phone: '0899999999' }, 200);
await pub('POST', `/public/queue/${SHOP}/NOPE`, { partySize: 4 }, 404);
await pub('POST', `/public/queue/${SHOP}/MAIN`, { partySize: 99 }, 400);
const c2 = await pub('POST', `/public/queue/${SHOP}/MAIN`, { partySize: 3 }, 200);
assert.match(c1.token, /^[0-9a-f]{32}$/);
let st = await pub('GET', `/public/queue/ticket/${c2.token}`, undefined, 200);
assert.equal(st.status, 'waiting');
const live = await call('GET', '/queue');
const idx = (code) => live.findIndex((t) => t.code === code);
assert.equal(st.aheadCount, live.filter((t) => t.number < Number(c2.code.slice(1))).length, 'ลำดับต้องนับเฉพาะคิวที่รออยู่ข้างหน้า');
const tk1 = live.find((t) => t.code === c1.code);
await call('POST', `/queue/${tk1.id}/call`, undefined, 200);
await call('POST', `/queue/${tk1.id}/call`, undefined, 200);
assert.equal((await call('GET', '/queue')).find((t) => t.id === tk1.id).callCount, 2);
const board = await pub('GET', `/public/queue/${SHOP}/MAIN/board`, undefined, 200);
assert.ok(board.calling.includes(c1.code));
assert.deepEqual(Object.keys(board).sort(), ['branch', 'calling', 'waiting']);
await call('POST', `/queue/${tk1.id}/seat`, { tableId: T.id }, 200);
await call('POST', `/queue/${tk1.id}/seat`, {}, 400); // ปิดแล้ว
await call('POST', `/queue/${tk1.id}/call`, undefined, 400);
st = await pub('GET', `/public/queue/ticket/${c1.token}`, undefined, 200);
assert.equal(st.status, 'seated');
await call('POST', `/queue/${q1.id}/seat`, { tableId: randomUUID() }, 400);
await pub('POST', `/public/queue/ticket/${c2.token}/cancel`, undefined, 200);
await pub('POST', `/public/queue/ticket/${c2.token}/cancel`, undefined, 400);
await call('POST', `/queue/${q1.id}/no-show`, undefined, 200);
assert.ok(!(await call('GET', '/queue')).some((t) => [tk1.id, q1.id].includes(t.id)));
await pub('GET', `/public/queue/ticket/${'f'.repeat(32)}`, undefined, 404);
ok('คิว: เข้าคิว/เรียก/เรียกซ้ำ/นั่ง/ยกเลิก/ไม่มา, ปิดแล้วเปลี่ยนไม่ได้, จอคิวไม่มีข้อมูลส่วนตัว');

// เลขคิวต่อเนื่องและไม่ซ้ำเมื่อเข้าพร้อมกัน
ip = rnd();
const burst = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/queue', { partySize: 2 }, 201)));
assert.equal(new Set(burst.map((b) => b.number)).size, 5);
ok('เข้าคิวพร้อมกัน 5 → เลขไม่ซ้ำ');
// limiter คิวสาธารณะ: 6 ครั้ง/10 นาที/IP
ip = rnd();
let q429 = 0;
for (let i = 0; i < 8; i++) {
  const t = token; token = '';
  const r = await fetch(`${API}/public/queue/${SHOP}/MAIN`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ partySize: 2 }) });
  token = t;
  if (r.status === 429) q429++;
}
assert.equal(q429, 2, 'ครั้งที่ 7-8 ต้องโดน 429');
ok('limiter: เข้าคิวสาธารณะถี่เกิน → 429');

console.log('\nPHASE 3 TEST PASSED');
