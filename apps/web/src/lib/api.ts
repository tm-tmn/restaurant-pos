import { useAuth } from '../store/auth';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ออฟไลน์/เซิร์ฟเวอร์ล่ม) — ต่างจาก ApiError ที่เซิร์ฟเวอร์ตอบกลับมาแล้ว */
export class NetworkError extends Error {
  constructor() {
    super('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';

/** auth: false = เรียก endpoint สาธารณะ (หน้าลูกค้า) โดยไม่แนบโทเค็นพนักงาน */
export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = opts.auth === false ? null : useAuth.getState().token;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (เช่นหน้า error ของ proxy) */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && opts.auth !== false) useAuth.getState().logout();
    const m = (data as { message?: string | string[] } | null)?.message;
    const msg = Array.isArray(m) ? m.join(', ') : (m ?? `เกิดข้อผิดพลาด (${res.status})`);
    // 502/503/504 จาก proxy/เซิร์ฟเวอร์ที่ยังไม่พร้อม ถือเป็นเชื่อมต่อไม่ได้ เพื่อให้ออเดอร์ค้างในคิวแล้วลองใหม่
    if ([502, 503, 504].includes(res.status)) throw new NetworkError();
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
