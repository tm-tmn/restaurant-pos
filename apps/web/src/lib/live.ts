/**
 * สัญญาณ real-time จากเซิร์ฟเวอร์ (WebSocket) — เมื่อบิล/ครัว/คิวของสาขาเปลี่ยน หน้าจอโหลดข้อมูลใหม่ทันที
 * เซิร์ฟเวอร์ส่งแค่ "หัวข้อที่เปลี่ยน" ไม่ส่งข้อมูลจริง → ข้อมูลยังดึงผ่าน API ที่ตรวจสิทธิ์ตามปกติ
 * ถ้าต่อไม่ได้ (ออฟไลน์/เซิร์ฟเวอร์รุ่นเก่า) หน้าจอยังโหลดเองเป็นระยะเหมือนเดิม (ดู useLiveInterval)
 */
import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { useAuth } from '../store/auth';

type Topic = 'orders' | 'kitchen' | 'queue';

/** หัวข้อ → query ที่ต้องโหลดใหม่ */
const KEYS: Record<Topic, string[][]> = {
  kitchen: [['kitchen']],
  orders: [['pending'], ['tables'], ['order'], ['report'], ['shift']],
  queue: [['queue'], ['tables']],
};

export const useLive = create<{ connected: boolean }>(() => ({ connected: false }));

/** ช่วงโหลดซ้ำ: ต่อ real-time ได้ = โหลดห่างๆ ไว้กันพลาดสัญญาณ, ต่อไม่ได้ = ใช้ช่วงเดิม */
export function useLiveInterval(fallbackMs: number, liveMs = 60_000) {
  const connected = useLive((s) => s.connected);
  return connected ? Math.max(liveMs, fallbackMs) : fallbackMs;
}

function originOf(): string {
  const base = import.meta.env.VITE_API_URL as string | undefined;
  // VITE_API_URL = https://api.example.com/api → socket ที่ https://api.example.com
  return base ? new URL(base, location.href).origin : location.origin;
}

let socket: Socket | null = null;

/** เริ่ม/หยุดตามสถานะล็อกอิน — เรียกครั้งเดียวตอนเปิดแอป คืนฟังก์ชันหยุด */
export function startLive(qc: QueryClient) {
  const connect = (token: string | null) => {
    socket?.close();
    socket = null;
    useLive.setState({ connected: false });
    if (!token) return;
    const s = io(originOf(), { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 15_000 });
    s.on('ready', () => {
      useLive.setState({ connected: true });
      // ต่อใหม่หลังหลุด: อาจพลาดสัญญาณระหว่างนั้น → โหลดทุกหัวข้อใหม่หนึ่งครั้ง
      for (const keys of Object.values(KEYS)) for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    });
    s.on('disconnect', () => useLive.setState({ connected: false }));
    s.on('auth_error', () => {
      // โทเค็นใช้ไม่ได้แล้ว — ให้คำขอ API ถัดไปจัดการออกจากระบบ ไม่ต้องพยายามต่อซ้ำ
      s.close();
      useLive.setState({ connected: false });
    });
    s.on('changed', (e: { topics?: Topic[] }) => {
      const keys = new Map<string, string[]>();
      for (const t of e.topics ?? []) for (const k of KEYS[t] ?? []) keys.set(k.join('/'), k);
      for (const k of keys.values()) void qc.invalidateQueries({ queryKey: k });
      window.dispatchEvent(new CustomEvent('pos-live', { detail: e.topics ?? [] }));
    });
    socket = s;
  };

  connect(useAuth.getState().token);
  const unsub = useAuth.subscribe((st, prev) => {
    if (st.token !== prev.token) connect(st.token);
  });
  return () => {
    unsub();
    socket?.close();
    socket = null;
  };
}
