/**
 * คิวออเดอร์ offline (IndexedDB)
 *
 * หลักการ: บิลขายหน้าร้าน (takeaway / quick sale) ถูก "บันทึกลงเครื่องก่อนเสมอ" แล้วค่อยส่งขึ้นเซิร์ฟเวอร์
 * - ส่งสำเร็จ (created/duplicate) → ลบออกจากคิว
 * - เซิร์ฟเวอร์ปฏิเสธ (rejected) → ย้ายไปกอง "ต้องตรวจสอบ" ไม่ลบทิ้ง
 * - เชื่อมต่อไม่ได้ → อยู่ในคิว ส่งใหม่อัตโนมัติ
 * เซิร์ฟเวอร์ใช้ clientId กันบิลซ้ำ จึงส่งซ้ำได้อย่างปลอดภัย
 */
import { createStore, del, entries, get, set } from 'idb-keyval';
import { create } from 'zustand';
import type { Menu, SyncOrderPayload } from '../types';
import { api, ApiError } from './api';

const queueStore = createStore('pos-offline', 'queue');
const failedStore = createStore('pos-offline-failed', 'failed');
const cacheStore = createStore('pos-cache', 'kv');

export interface QueuedOrder {
  payload: SyncOrderPayload;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}
export interface FailedOrder extends QueuedOrder {
  rejectedAt: string;
}

type SyncResult = { clientId: string; status: 'created' | 'duplicate'; orderNo: string } | { clientId: string; status: 'rejected'; error: string };

interface SyncState {
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncAt: string | null;
  refreshCounts: () => Promise<void>;
}

export const useSync = create<SyncState>((set) => ({
  pending: 0,
  failed: 0,
  syncing: false,
  lastSyncAt: null,
  refreshCounts: async () => {
    const [q, f] = await Promise.all([entries(queueStore), entries(failedStore)]);
    set({ pending: q.length, failed: f.length });
  },
}));

export async function enqueueOrder(payload: SyncOrderPayload) {
  await set(payload.clientId, { payload, queuedAt: new Date().toISOString(), attempts: 0 } satisfies QueuedOrder, queueStore);
  await useSync.getState().refreshCounts();
}

let inflight: Promise<Map<string, SyncResult>> | null = null;
let queued: Promise<Map<string, SyncResult>> | null = null;

/**
 * ส่งคิวทั้งหมดขึ้นเซิร์ฟเวอร์ — คืนผลรายบิล
 * ถ้ามีรอบที่กำลังส่งอยู่ จะรอรอบนั้นจบแล้วเริ่มรอบใหม่ (ผู้เรียกที่เพิ่งเข้าคิวจึงได้ผลของบิลตัวเองเสมอ)
 * ผู้เรียกหลายรายระหว่างรอ ใช้รอบใหม่ร่วมกัน ไม่ยิงซ้ำซ้อน
 */
export function flushQueue(): Promise<Map<string, SyncResult>> {
  if (queued) return queued;
  const prev = inflight ?? Promise.resolve(new Map<string, SyncResult>());
  queued = prev
    .catch(() => new Map<string, SyncResult>())
    .then((prevResults) => {
      queued = null;
      const round = doFlush().finally(() => {
        inflight = null;
      });
      inflight = round;
      // รวมผลของรอบก่อนหน้า: บิลที่เพิ่งเข้าคิวอาจถูกส่งไปแล้วในรอบที่กำลังวิ่งอยู่
      return round.then((r) => new Map([...prevResults, ...r]));
    });
  return queued;
}

/** หยุดทั้งรอบ: ส่งต่อไปก็ไม่สำเร็จ (ออฟไลน์ / ต้อง login ใหม่ / เซิร์ฟเวอร์มีปัญหา) */
class StopFlush extends Error {}

async function keep(batch: QueuedOrder[], message: string) {
  for (const b of batch) await set(b.payload.clientId, { ...b, attempts: b.attempts + 1, lastError: message }, queueStore);
}

async function reject(item: QueuedOrder, error: string, out: Map<string, SyncResult>) {
  await set(item.payload.clientId, { ...item, attempts: item.attempts + 1, lastError: error, rejectedAt: new Date().toISOString() } satisfies FailedOrder, failedStore);
  await del(item.payload.clientId, queueStore);
  out.set(item.payload.clientId, { clientId: item.payload.clientId, status: 'rejected', error });
}

/**
 * ส่งหนึ่งชุด ถ้าเซิร์ฟเวอร์ปฏิเสธทั้งชุดเพราะข้อมูล (400/413/422) — ซึ่งเกิดได้จากบิลเสียเพียงใบเดียว —
 * จะแบ่งครึ่งส่งใหม่จนเหลือใบเดียว แล้วย้ายเฉพาะใบนั้นไปกอง "ต้องตรวจสอบ" บิลดีในชุดเดียวกันจึงไม่ค้าง
 */
async function sendBatch(batch: QueuedOrder[], out: Map<string, SyncResult>): Promise<void> {
  let res: { results: SyncResult[] };
  try {
    res = await api<{ results: SyncResult[] }>('/sync/orders', { body: { orders: batch.map((b) => b.payload) } });
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof ApiError && [400, 413, 422].includes(e.status)) {
      if (batch.length === 1) return reject(batch[0], msg, out);
      const mid = Math.ceil(batch.length / 2);
      await sendBatch(batch.slice(0, mid), out);
      return sendBatch(batch.slice(mid), out);
    }
    await keep(batch, msg);
    throw new StopFlush(msg);
  }
  for (const r of res.results) {
    const item = batch.find((b) => b.payload.clientId === r.clientId);
    if (!item) continue;
    if (r.status === 'rejected') await reject(item, r.error, out);
    else {
      out.set(r.clientId, r);
      await del(r.clientId, queueStore);
    }
  }
}

async function doFlush(): Promise<Map<string, SyncResult>> {
  const out = new Map<string, SyncResult>();
  const all = (await entries<string, QueuedOrder>(queueStore)).map(([, v]) => v);
  if (all.length === 0) return out;
  useSync.setState({ syncing: true });
  try {
    all.sort((a, b) => a.payload.occurredAt.localeCompare(b.payload.occurredAt));
    for (let i = 0; i < all.length; i += 50) await sendBatch(all.slice(i, i + 50), out);
    useSync.setState({ lastSyncAt: new Date().toISOString() });
  } catch (e) {
    if (!(e instanceof StopFlush)) throw e;
  } finally {
    useSync.setState({ syncing: false });
    await useSync.getState().refreshCounts();
  }
  return out;
}

export async function listFailed(): Promise<FailedOrder[]> {
  return (await entries<string, FailedOrder>(failedStore)).map(([, v]) => v).sort((a, b) => b.rejectedAt.localeCompare(a.rejectedAt));
}
export async function retryFailed(clientId: string) {
  const f = await get<FailedOrder>(clientId, failedStore);
  if (!f) return;
  await set(clientId, { payload: f.payload, queuedAt: f.queuedAt, attempts: f.attempts, lastError: f.lastError } satisfies QueuedOrder, queueStore);
  await del(clientId, failedStore);
  await flushQueue();
}
export async function discardFailed(clientId: string) {
  await del(clientId, failedStore);
  await useSync.getState().refreshCounts();
}

// ---- แคชเมนูสำหรับใช้ตอนออฟไลน์ ----
export const cacheMenu = (m: Menu) => set('menu', m, cacheStore);
export const cachedMenu = () => get<Menu>('menu', cacheStore);

/** เริ่มตัวซิงค์อัตโนมัติ: ตอนกลับมาออนไลน์ และทุก 30 วินาที */
export function startAutoSync() {
  void useSync.getState().refreshCounts();
  void flushQueue();
  window.addEventListener('online', () => void flushQueue());
  const t = setInterval(() => {
    if (navigator.onLine) void flushQueue();
  }, 30_000);
  return () => clearInterval(t);
}
