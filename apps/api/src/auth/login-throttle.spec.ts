import { LoginThrottle } from './login-throttle';

describe('LoginThrottle', () => {
  let t = 0;
  const th = () => new LoginThrottle({ maxFails: 3, windowMs: 60_000, lockMs: 30_000 }, () => t);

  beforeEach(() => (t = 1_000_000));

  it('ล็อกเมื่อผิดครบจำนวน และปลดล็อกเมื่อครบเวลา', () => {
    const l = th();
    l.fail(['u:a']);
    l.fail(['u:a']);
    expect(l.retryAfter(['u:a'])).toBe(0);
    l.fail(['u:a']);
    expect(l.retryAfter(['u:a'])).toBe(30);
    t += 29_000;
    expect(l.retryAfter(['u:a'])).toBe(1);
    t += 1_001;
    expect(l.retryAfter(['u:a'])).toBe(0);
  });

  it('ผิดห่างกันเกินหน้าต่างเวลาไม่นับสะสม', () => {
    const l = th();
    l.fail(['u:a']);
    l.fail(['u:a']);
    t += 61_000;
    l.fail(['u:a']);
    expect(l.retryAfter(['u:a'])).toBe(0);
  });

  it('เข้าสำเร็จแล้วล้างตัวนับ', () => {
    const l = th();
    l.fail(['u:a']);
    l.fail(['u:a']);
    l.success(['u:a']);
    l.fail(['u:a']);
    expect(l.retryAfter(['u:a'])).toBe(0);
  });

  it('นับ IP แยก: เดาหลายบัญชีจาก IP เดียวก็โดนล็อก', () => {
    const l = th();
    l.fail(['u:a', 'ip:1']);
    l.fail(['u:b', 'ip:1']);
    l.fail(['u:c', 'ip:1']);
    expect(l.retryAfter(['u:d', 'ip:1'])).toBeGreaterThan(0);
    expect(l.retryAfter(['u:d', 'ip:2'])).toBe(0);
  });
});
