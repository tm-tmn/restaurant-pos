import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOrderPayload } from '../types';

/**
 * ทดสอบคิวออฟไลน์กับ "เซิร์ฟเวอร์จำลอง":
 * - บิลที่ unitPriceSatang === 13 ถือเป็นบิลเสีย → เซิร์ฟเวอร์ตอบ 400 ทั้งชุด (เหมือน ValidationPipe)
 * - บิลที่ qty === 7 → เซิร์ฟเวอร์รับชุดแต่ตอบ rejected รายใบ
 */
let serverDown = false;
let calls: number[] = [];
const seen = new Set<string>();

function mockServer() {
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (serverDown) throw new TypeError('Failed to fetch');
    const { orders } = JSON.parse(String(init?.body)) as { orders: SyncOrderPayload[] };
    calls.push(orders.length);
    if (orders.some((o) => o.items[0].unitPriceSatang === 13)) {
      return new Response(JSON.stringify({ statusCode: 400, message: 'invalid order' }), { status: 400 });
    }
    const results = orders.map((o) => {
      if (o.items[0].qty === 7) return { clientId: o.clientId, status: 'rejected', error: 'ยอดไม่ตรง' };
      const dup = seen.has(o.clientId);
      seen.add(o.clientId);
      return { clientId: o.clientId, status: dup ? 'duplicate' : 'created', orderNo: 'N-' + o.clientId.slice(0, 4) };
    });
    return new Response(JSON.stringify({ results }), { status: 200 });
  }) as typeof fetch;
}

let seq = 0;
function order(price = 100, qty = 1): SyncOrderPayload {
  const id = `${String(++seq).padStart(8, '0')}-0000-4000-8000-000000000000`;
  return {
    clientId: id,
    type: 'takeaway',
    occurredAt: new Date(Date.now() + seq).toISOString(),
    items: [{ name: 'x', unitPriceSatang: price, qty }],
    payments: [{ method: 'cash', amountSatang: price * qty }],
  };
}

async function freshModule() {
  vi.resetModules();
  // ล้าง IndexedDB ระหว่างเทสต์
  const { IDBFactory } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();
  return import('./offline');
}

beforeEach(() => {
  serverDown = false;
  calls = [];
  seen.clear();
  mockServer();
});

describe('offline queue', () => {
  it('ส่งสำเร็จ → ลบออกจากคิว', async () => {
    const m = await freshModule();
    const o = order();
    await m.enqueueOrder(o);
    const res = await m.flushQueue();
    expect(res.get(o.clientId)?.status).toBe('created');
    expect(m.useSync.getState().pending).toBe(0);
  });

  it('ออฟไลน์ → ยังอยู่ในคิว ส่งได้เมื่อกลับมาออนไลน์ และไม่เกิดบิลซ้ำ', async () => {
    const m = await freshModule();
    const o = order();
    await m.enqueueOrder(o);
    serverDown = true;
    const r1 = await m.flushQueue();
    expect(r1.size).toBe(0);
    expect(m.useSync.getState().pending).toBe(1);
    serverDown = false;
    const r2 = await m.flushQueue();
    expect(r2.get(o.clientId)?.status).toBe('created');
    expect(m.useSync.getState().pending).toBe(0);
  });

  it('บิลเสียใบเดียวในชุด → แบ่งชุดส่งใหม่ บิลดีผ่านหมด ใบเสียไปกองตรวจสอบ', async () => {
    const m = await freshModule();
    const good = Array.from({ length: 9 }, () => order());
    const bad = order(13);
    for (const o of [...good.slice(0, 4), bad, ...good.slice(4)]) await m.enqueueOrder(o);
    const res = await m.flushQueue();
    for (const g of good) expect(res.get(g.clientId)?.status).toBe('created');
    expect(res.get(bad.clientId)?.status).toBe('rejected');
    expect(m.useSync.getState().pending).toBe(0);
    expect(m.useSync.getState().failed).toBe(1);
    const failed = await m.listFailed();
    expect(failed[0].payload.clientId).toBe(bad.clientId);
    expect(failed[0].lastError).toBe('invalid order');
    expect(calls[0]).toBe(10); // ส่งทั้งชุดก่อน แล้วค่อยแบ่ง
  });

  it('เซิร์ฟเวอร์ตอบ rejected รายใบ → ย้ายไปกองตรวจสอบ, ลบทิ้งได้', async () => {
    const m = await freshModule();
    const ok = order();
    const rej = order(100, 7);
    await m.enqueueOrder(ok);
    await m.enqueueOrder(rej);
    const res = await m.flushQueue();
    expect(res.get(ok.clientId)?.status).toBe('created');
    expect(res.get(rej.clientId)?.status).toBe('rejected');
    expect(m.useSync.getState().failed).toBe(1);
    await m.discardFailed(rej.clientId);
    expect(m.useSync.getState().failed).toBe(0);
  });

  it('เรียก flush ระหว่างที่รอบก่อนยังส่งอยู่ → ได้ผลของบิลที่เพิ่งเข้าคิวด้วย', async () => {
    const m = await freshModule();
    const first = order();
    await m.enqueueOrder(first);
    const p1 = m.flushQueue(); // เริ่มรอบแรก
    const second = order();
    await m.enqueueOrder(second); // เข้าคิวระหว่างรอบแรกกำลังส่ง
    const p2 = m.flushQueue();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.get(first.clientId)?.status).toBe('created');
    expect(r2.get(second.clientId)?.status).toBe('created');
    expect(m.useSync.getState().pending).toBe(0);
  });

  it('ส่งเกิน 50 บิล → แบ่งเป็นชุดละไม่เกิน 50', async () => {
    const m = await freshModule();
    for (let i = 0; i < 120; i++) await m.enqueueOrder(order());
    await m.flushQueue();
    expect(calls).toEqual([50, 50, 20]);
    expect(m.useSync.getState().pending).toBe(0);
  });
});
