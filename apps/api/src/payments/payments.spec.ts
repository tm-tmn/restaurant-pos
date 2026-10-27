import { crc16, promptPayPayload, PromptPayError } from './promptpay';
import { signWebhook, verifyWebhook } from './webhook-signature';

describe('promptpay (server)', () => {
  it('CRC16 ตรงเวกเตอร์มาตรฐาน', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('payload เบอร์โทร: มีเบอร์รูปแบบ 0066, ยอด 2 ตำแหน่ง และ CRC ถูกต้อง', () => {
    const p = promptPayPayload('0812345678', 12550);
    expect(p).toContain('0066812345678');
    expect(p).toContain('5406125.50');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
  it('เลข 13 หลักใช้ tag 02', () => {
    expect(promptPayPayload('1234567890123', 100)).toContain('02131234567890123');
  });
  it('ปฏิเสธ ID/ยอดที่ไม่ถูกต้อง', () => {
    expect(() => promptPayPayload('12345', 100)).toThrow(PromptPayError);
    expect(() => promptPayPayload('0812345678', 0)).toThrow(PromptPayError);
    expect(() => promptPayPayload('0812345678', 1.5)).toThrow(PromptPayError);
  });
});

describe('webhook signature', () => {
  const secret = 'whsec_test_0123456789';
  const body = '{"intentId":"x","amountSatang":100}';
  const now = 1_800_000_000_000;

  it('ลายเซ็นถูกต้องผ่าน', () => {
    expect(verifyWebhook(secret, String(now), signWebhook(secret, now, body), body, now)).toBe(true);
  });
  it('เนื้อหาถูกแก้ → ไม่ผ่าน', () => {
    expect(verifyWebhook(secret, String(now), signWebhook(secret, now, body), body.replace('100', '1'), now)).toBe(false);
  });
  it('secret ผิด / ไม่มี signature / signature ไม่ใช่ hex → ไม่ผ่าน', () => {
    expect(verifyWebhook(secret, String(now), signWebhook('other', now, body), body, now)).toBe(false);
    expect(verifyWebhook(secret, String(now), undefined, body, now)).toBe(false);
    expect(verifyWebhook(secret, String(now), 'zzzz', body, now)).toBe(false);
  });
  it('timestamp เก่าเกิน 5 นาที หรือรูปแบบผิด → ไม่ผ่าน', () => {
    const old = now - 6 * 60_000;
    expect(verifyWebhook(secret, String(old), signWebhook(secret, old, body), body, now)).toBe(false);
    expect(verifyWebhook(secret, 'abc', signWebhook(secret, now, body), body, now)).toBe(false);
  });
  it('ไม่ได้ตั้ง secret → ไม่ผ่านเสมอ', () => {
    expect(verifyWebhook('', String(now), signWebhook('', now, body), body, now)).toBe(false);
  });
});
