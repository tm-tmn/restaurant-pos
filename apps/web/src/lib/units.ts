/** หน่วยฐาน (เก็บในระบบเป็นจำนวนเต็ม) และหน่วยที่ผู้ใช้กรอก/อ่านได้สะดวก */
export type BaseUnit = 'g' | 'ml' | 'pcs';

export const UNIT_TH: Record<BaseUnit, string> = { g: 'กรัม', ml: 'มล.', pcs: 'ชิ้น' };

/** หน่วยกรอกที่เลือกได้ต่อหน่วยฐาน: [ชื่อ, ตัวคูณเป็นหน่วยฐาน] */
export const INPUT_UNITS: Record<BaseUnit, { label: string; factor: number }[]> = {
  g: [
    { label: 'กก.', factor: 1000 },
    { label: 'กรัม', factor: 1 },
  ],
  ml: [
    { label: 'ลิตร', factor: 1000 },
    { label: 'มล.', factor: 1 },
  ],
  pcs: [{ label: 'ชิ้น', factor: 1 }],
};

/** แปลงข้อความที่กรอก × ตัวคูณ → จำนวนเต็มหน่วยฐาน; null ถ้าไม่ถูกต้อง */
export function toBase(input: string, factor: number): number | null {
  const s = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * factor);
  return n > 0 ? n : null;
}

/** แสดงปริมาณแบบอ่านง่าย: 2500 g → "2.5 กก." */
export function fmtQty(qty: number, unit: BaseUnit): string {
  const abs = Math.abs(qty);
  if ((unit === 'g' || unit === 'ml') && abs >= 1000) {
    return `${(qty / 1000).toLocaleString('th-TH', { maximumFractionDigits: 2 })} ${unit === 'g' ? 'กก.' : 'ลิตร'}`;
  }
  return `${qty.toLocaleString('th-TH')} ${UNIT_TH[unit]}`;
}

/** ต้นทุนเฉลี่ยต่อหน่วยที่คนคุ้นเคย: กรัม → บาท/กก., มล. → บาท/ลิตร, ชิ้น → บาท/ชิ้น */
export function fmtUnitCost(satangPerBase: number, unit: BaseUnit): string {
  if (!satangPerBase) return '—';
  const perUnit = unit === 'pcs' ? satangPerBase / 100 : (satangPerBase * 1000) / 100;
  return `฿${perUnit.toLocaleString('th-TH', { maximumFractionDigits: 2 })}/${unit === 'g' ? 'กก.' : unit === 'ml' ? 'ลิตร' : 'ชิ้น'}`;
}
