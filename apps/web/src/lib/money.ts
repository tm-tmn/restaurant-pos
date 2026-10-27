/** เงินทั้งหมดเป็นจำนวนเต็ม "สตางค์" — แปลงเป็นข้อความบาทเฉพาะตอนแสดงผล */
export function baht(satang: number): string {
  const n = satang / 100;
  return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/** แปลงข้อความที่ผู้ใช้พิมพ์ (บาท) เป็นสตางค์; คืน null ถ้าไม่ใช่ตัวเลขที่ถูกต้อง */
export function parseBahtToSatang(input: string): number | null {
  const s = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}
