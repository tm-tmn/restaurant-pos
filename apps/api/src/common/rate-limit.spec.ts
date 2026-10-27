import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  it('อนุญาตไม่เกินโควตาต่อหน้าต่างเวลา แล้วปล่อยเมื่อเลยหน้าต่าง', () => {
    let t = 0;
    const r = new RateLimiter(3, 1000, () => t);
    expect([r.take('a'), r.take('a'), r.take('a'), r.take('a')]).toEqual([true, true, true, false]);
    expect(r.take('b')).toBe(true); // คนละกุญแจ
    t = 1001;
    expect(r.take('a')).toBe(true);
  });

  it('ครั้งที่ถูกปฏิเสธไม่ถูกนับเพิ่ม (ไม่ล็อกยาวขึ้นเรื่อยๆ)', () => {
    let t = 0;
    const r = new RateLimiter(1, 1000, () => t);
    r.take('a');
    t = 500;
    expect(r.take('a')).toBe(false);
    t = 1001;
    expect(r.take('a')).toBe(true);
  });
});
