/**
 * ทดสอบ real-time (WebSocket): เครื่องในสาขาได้สัญญาณเมื่อบิล/ครัว/คิวเปลี่ยน, ร้านอื่นไม่ได้, โทเค็นผิดต่อไม่ได้
 *   DATABASE_URL=... API_URL=http://localhost:3000/api node scripts/realtime.mjs
 * มี DATABASE_URL จะสร้างร้านที่สองเพื่อตรวจว่าสัญญาณไม่ข้ามร้าน (ต้อง build API แล้ว)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000/api';
const ORIGIN = API.replace(/\/api\/?$/, '');
const SHOP = process.env.SHOP ?? 'main';
const ok = (m) => console.log('✓', m);
const ip = `10.88.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;

async function call(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  assert.ok(res.ok, `${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(ORIGIN, { auth: { token }, transports: ['websocket'], reconnection: false });
    const events = [];
    s.on('changed', (e) => events.push(e));
    s.once('ready', () => resolve({ s, events }));
    s.once('auth_error', () => reject(new Error('auth_error')));
    s.once('connect_error', reject);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
}
const waitFor = async (events, pred, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (events.some(pred)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

const a = await call('', 'POST', '/auth/login', { tenant: SHOP, username: 'owner', password: process.env.OWNER_PASSWORD ?? 'ChangeMe!2026' });
const A = await connect(a.token);
let B = null;
if (process.env.DATABASE_URL) {
  const slug = `rt-${Date.now() % 1_000_000}`;
  const cli = join(dirname(fileURLToPath(import.meta.url)), '../dist/tenants/create-tenant.js');
  execFileSync(process.execPath, [cli, '--slug', slug, '--name', 'ร้าน RT', '--password', 'shop-b-pass-1', '--tables', '1'], { env: process.env, stdio: 'pipe' });
  const b = await call('', 'POST', '/auth/login', { tenant: slug, username: 'owner', password: 'shop-b-pass-1' });
  B = await connect(b.token);
}
ok('ต่อ WebSocket ด้วยโทเค็นได้');

await assert.rejects(connect('not-a-token'), /auth_error|timeout/);
await assert.rejects(connect(undefined), /auth_error|timeout/);
ok('โทเค็นผิด/ไม่มีโทเค็น ต่อไม่ได้');

// บิลใหม่ → orders + kitchen
const menu = await call(a.token, 'GET', '/catalog/menu');
const t = await call(a.token, 'POST', '/tables', { name: `RT${Date.now() % 100000}`, seats: 2 });
const t0 = Date.now();
const o = await call(a.token, 'POST', '/orders', { clientId: randomUUID(), type: 'dine_in', tableId: t.id, items: [{ productId: menu.products[0].id, qty: 1 }] });
assert.ok(await waitFor(A.events, (e) => e.topics.includes('kitchen') && e.topics.includes('orders')), 'ต้องได้สัญญาณเมื่อเปิดบิล');
const latency = Date.now() - t0;
ok(`เปิดบิล → เครื่องในสาขาได้สัญญาณ orders+kitchen (${latency}ms)`);

// ครัวเปลี่ยนสถานะ → kitchen
A.events.length = 0;
const board = await call(a.token, 'GET', '/kitchen');
const ticket = board.find((k) => k.orderId === o.id);
assert.ok(ticket, 'บิลต้องขึ้นจอครัว');
await call(a.token, 'POST', `/kitchen/orders/${o.id}/status`, { status: 'preparing' });
assert.ok(await waitFor(A.events, (e) => e.topics.includes('kitchen')));
ok('ครัวกดเริ่มทำ → ได้สัญญาณ kitchen');

// คิว → queue
A.events.length = 0;
await call(a.token, 'POST', '/queue', { partySize: 2 });
assert.ok(await waitFor(A.events, (e) => e.topics.includes('queue')));
ok('เพิ่มคิว → ได้สัญญาณ queue');

await call(a.token, 'POST', `/orders/${o.id}/void`, { reason: 'ทดสอบ real-time' });
if (B) {
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(B.events.length, 0, 'ร้านอื่นต้องไม่ได้สัญญาณของร้านนี้');
  ok('ร้านอื่นไม่ได้รับสัญญาณ');
}
A.s.close();
B?.s.close();
console.log('\nREALTIME TEST PASSED');
process.exit(0);
