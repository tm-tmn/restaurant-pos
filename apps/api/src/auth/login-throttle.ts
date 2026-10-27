/**
 * กันเดารหัสผ่าน: ผิดเกิน MAX_FAILS ครั้งภายใน WINDOW → ล็อก LOCK ms
 * นับแยก 2 กุญแจ: (ชื่อผู้ใช้) และ (IP) — กันทั้งเดารหัสบัญชีเดียว และไล่เดาหลายบัญชีจากเครื่องเดียว
 * เก็บในหน่วยความจำ (พอสำหรับ API instance เดียว; ถ้าขยายหลาย instance ให้ย้ายไป Redis)
 */
export interface ThrottleOptions {
  maxFails: number;
  windowMs: number;
  lockMs: number;
}

interface Entry {
  fails: number;
  first: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly map = new Map<string, Entry>();

  constructor(
    private readonly opt: ThrottleOptions = { maxFails: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
    private readonly now: () => number = Date.now,
  ) {}

  /** คืนจำนวนวินาทีที่ต้องรอ ถ้าถูกล็อกอยู่ (0 = ผ่านได้) */
  retryAfter(keys: string[]): number {
    const t = this.now();
    let wait = 0;
    for (const k of keys) {
      const e = this.map.get(k);
      if (e && e.lockedUntil > t) wait = Math.max(wait, Math.ceil((e.lockedUntil - t) / 1000));
    }
    return wait;
  }

  fail(keys: string[]) {
    const t = this.now();
    for (const k of keys) {
      let e = this.map.get(k);
      if (!e || t - e.first > this.opt.windowMs) e = { fails: 0, first: t, lockedUntil: 0 };
      e.fails++;
      if (e.fails >= this.opt.maxFails) {
        e.lockedUntil = t + this.opt.lockMs;
        e.fails = 0;
        e.first = t;
      }
      this.map.set(k, e);
    }
    if (this.map.size > 10_000) this.prune();
  }

  success(keys: string[]) {
    for (const k of keys) this.map.delete(k);
  }

  private prune() {
    const t = this.now();
    for (const [k, e] of this.map) if (e.lockedUntil < t && t - e.first > this.opt.windowMs) this.map.delete(k);
  }
}
