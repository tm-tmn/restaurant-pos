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
import { api, ApiError, NetworkError } from './api';

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

/** ส่งคิวทั้งหมดขึ้นเซิร์ฟเวอร์ (กันการเรียกซ้อน) — คืนผลรายบิล */
export function flushQueue(): Promise<Map<string, SyncResult>> {
  if (!inflight) {
    inflight = doFlush().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function doFlush(): Promise<Map<string, SyncResult>> {
  const out = new Map<string, SyncResult>();
  const all = (await entries<string, QueuedOrder>(queueStore)).map(([, v]) => v);
  if (all.length === 0) return out;
  useSync.setState({ syncing: true });
  try {
    all.sort((a, b) => a.payload.occurredAt.localeCompare(b.payload.occurredAt));
    for (let i = 0; i < all.length; i += 50) {
      const batch = all.slice(i, i + 50);
      let res: { results: SyncResult[] };
      try {
        res = await api<{ results: SyncResult[] }>('/sync/orders', { body: { orders: batch.map((b) => b.payload) } });
      } catch (e) {
        // เชื่อมต่อไม่ได้/ยังไม่ได้ login → เก็บไว้ในคิวรอรอบถัดไป
        for (const b of batch) {
          await set(b.payload.clientId, { ...b, attempts: b.attempts + 1, lastError: (e as Error).message }, queueStore);
        }
        if (e instanceof NetworkError || (e instanceof ApiError && e.status === 401)) break;
        continue;
      }
      for (const r of res.results) {
        out.set(r.clientId, r);
        const item = batch.find((b) => b.payload.clientId === r.clientId);
        if (r.status === 'rejected' && item) {
          await set(r.clientId, { ...item, attempts: item.attempts + 1, lastError: r.error, rejectedAt: new Date().toISOString() } satisfies FailedOrder, failedStore);
        }
        await del(r.clientId, queueStore);
      }
    }
    useSync.setState({ lastSyncAt: new Date().toISOString() });
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
