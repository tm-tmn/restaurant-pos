/**
 * ตัวจำกัดอัตราแบบหน้าต่างเลื่อน (sliding window) เก็บในหน่วยความจำ
 * ใช้กับ endpoint สาธารณะ (ลูกค้าสแกน QR) ที่ไม่มีการล็อกอิน — กันสแปมออเดอร์/คิว
 * พอสำหรับ API instance เดียว; ถ้าขยายหลาย instance ให้ย้ายไป Redis
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** บันทึกการเรียกหนึ่งครั้ง; คืน true ถ้ายังไม่เกินโควตา, false ถ้าเกิน (และไม่นับครั้งนี้) */
  take(key: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(t);
    this.hits.set(key, arr);
    if (this.hits.size > 20_000) this.prune();
    return true;
  }

  private prune() {
    const t = this.now();
    for (const [k, arr] of this.hits) if (arr.every((x) => t - x >= this.windowMs)) this.hits.delete(k);
  }
}
