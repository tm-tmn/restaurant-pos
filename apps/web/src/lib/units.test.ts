import { describe, expect, it } from 'vitest';
import { fmtQty, fmtUnitCost, toBase } from './units';

describe('units', () => {
  it('toBase แปลงหน่วยกรอกเป็นหน่วยฐานจำนวนเต็ม', () => {
    expect(toBase('2.5', 1000)).toBe(2500);
    expect(toBase('150', 1)).toBe(150);
    expect(toBase('1,000', 1)).toBe(1000);
    expect(toBase('0', 1)).toBeNull();
    expect(toBase('abc', 1)).toBeNull();
    expect(toBase('-1', 1)).toBeNull();
  });
  it('fmtQty', () => {
    expect(fmtQty(2500, 'g')).toBe('2.5 กก.');
    expect(fmtQty(150, 'g')).toBe('150 กรัม');
    expect(fmtQty(-1200, 'ml')).toBe('-1.2 ลิตร');
    expect(fmtQty(30, 'pcs')).toBe('30 ชิ้น');
  });
  it('fmtUnitCost', () => {
    expect(fmtUnitCost(20, 'g')).toBe('฿200/กก.');
    expect(fmtUnitCost(450, 'pcs')).toBe('฿4.5/ชิ้น');
    expect(fmtUnitCost(0, 'g')).toBe('—');
  });
});

import { baht, parseBahtToSatang } from './money';
describe('money', () => {
  it('baht แสดงค่าติดลบเป็น -฿', () => {
    expect(baht(-1050)).toBe('-฿10.50');
    expect(baht(6000)).toBe('฿60');
    expect(baht(0)).toBe('฿0');
  });
  it('parseBahtToSatang', () => {
    expect(parseBahtToSatang('1,234.5')).toBe(123450);
    expect(parseBahtToSatang('0.07')).toBe(7);
    expect(parseBahtToSatang('1.234')).toBeNull();
    expect(parseBahtToSatang('-5')).toBeNull();
  });
});
