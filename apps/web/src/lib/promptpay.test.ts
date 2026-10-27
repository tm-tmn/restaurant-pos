import { describe, expect, it } from 'vitest';
import { crc16, promptPayPayload, PromptPayError } from './promptpay';

describe('crc16', () => {
  it('ตรงกับค่ามาตรฐาน CRC-16/CCITT-FALSE ("123456789" → 29B1)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('promptPayPayload', () => {
  it('เบอร์โทร: แปลงเป็น 0066... และใส่ยอดเงิน', () => {
    const p = promptPayPayload('0812345678', 15050);
    expect(p.startsWith('000201010212')).toBe(true); // dynamic QR
    expect(p).toContain('0016A000000677010111');
    expect(p).toContain('01130066812345678');
    expect(p).toContain('5406150.50');
    expect(p).toContain('5802TH');
    expect(p).toContain('5303764');
  });

  it('CRC ท้าย payload ถูกต้อง', () => {
    const p = promptPayPayload('0812345678', 10000);
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(p.slice(-8, -4)).toBe('6304');
  });

  it('เลข 13 หลักใช้แท็ก 02', () => {
    const p = promptPayPayload('1234567890123', 100);
    expect(p).toContain('02131234567890123');
  });

  it('ไม่ใส่ยอด → static QR (11) และไม่มีแท็ก 54', () => {
    const p = promptPayPayload('0812345678');
    expect(p.startsWith('000201010211')).toBe(true);
    expect(p).not.toContain('54');
  });

  it('ยอดทศนิยมสองหลักเสมอ', () => {
    expect(promptPayPayload('0812345678', 6000)).toContain('540560.00');
  });

  it('ปฏิเสธ ID และยอดที่ไม่ถูกต้อง', () => {
    expect(() => promptPayPayload('12345')).toThrow(PromptPayError);
    expect(() => promptPayPayload('0812345678', 0)).toThrow(PromptPayError);
    expect(() => promptPayPayload('0812345678', 10.5)).toThrow(PromptPayError);
  });
});
