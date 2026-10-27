/**
 * ตรรกะต้นทุนสต็อกแบบถัวเฉลี่ยถ่วงน้ำหนัก (Weighted Average Cost)
 *
 * เก็บเป็นจำนวนเต็มทั้งหมด:
 *   qty   = ปริมาณในหน่วยฐาน (กรัม / มิลลิลิตร / ชิ้น) — ติดลบได้ (ขายเกินสต็อกที่บันทึก)
 *   value = มูลค่าคงเหลือ (สตางค์)
 * ต้นทุนเฉลี่ยต่อหน่วย = value / qty ไม่เก็บแยก จึงไม่มีปัญหาทศนิยมสะสม
 */

export interface Level {
  qty: number;
  valueSatang: number;
}

export class StockError extends Error {}

function assertQty(n: number, label = 'ปริมาณ') {
  if (!Number.isInteger(n) || n <= 0) throw new StockError(`${label}ต้องเป็นจำนวนเต็มมากกว่า 0 (หน่วยฐาน)`);
}

/** ต้นทุนเฉลี่ยต่อหน่วยฐาน (สตางค์, ทศนิยมได้) — ใช้แสดงผล/คำนวณสูตรเท่านั้น */
export function avgCost(l: Level): number {
  return l.qty > 0 ? l.valueSatang / l.qty : 0;
}

/** รับเข้า: เพิ่มทั้งปริมาณและมูลค่า (ราคาที่จ่ายจริงทั้งก้อน) */
export function receive(l: Level, qty: number, totalCostSatang: number): { next: Level; valueDelta: number } {
  assertQty(qty);
  if (!Number.isInteger(totalCostSatang) || totalCostSatang < 0) throw new StockError('ราคารวมต้องเป็นจำนวนเต็มสตางค์ที่ไม่ติดลบ');
  if (l.qty < 0) {
    // เคยขายเกินสต็อก: ส่วนที่ติดลบถูกตัดออกไปด้วยมูลค่า 0 → รับเข้ามาชดเชยก่อน แล้วมูลค่าที่เหลือเป็นของคงเหลือใหม่
    const nextQty = l.qty + qty;
    const nextValue = nextQty > 0 ? Math.round((totalCostSatang * nextQty) / qty) : 0;
    return { next: { qty: nextQty, valueSatang: nextValue }, valueDelta: nextValue - l.valueSatang };
  }
  return { next: { qty: l.qty + qty, valueSatang: l.valueSatang + totalCostSatang }, valueDelta: totalCostSatang };
}

/**
 * ตัดออก (ขาย / เบิกใช้ / ของเสีย / โอนออก) ตามต้นทุนเฉลี่ย
 * allowNegative: การขายต้องไม่ถูกบล็อกเพราะสต็อกในระบบไม่ตรง จึงยอมให้ติดลบได้
 */
export function consume(l: Level, qty: number, allowNegative: boolean): { next: Level; valueDelta: number } {
  assertQty(qty);
  if (!allowNegative && qty > l.qty) throw new StockError(`สต็อกไม่พอ (คงเหลือ ${Math.max(0, l.qty)})`);
  if (l.qty <= 0) return { next: { qty: l.qty - qty, valueSatang: 0 }, valueDelta: 0 - l.valueSatang || 0 };
  const take = Math.min(qty, l.qty);
  // ตัดส่วนสุดท้ายพอดี → มูลค่าเป็น 0 พอดี ไม่เหลือเศษสตางค์ค้าง
  const valueOut = take === l.qty ? l.valueSatang : Math.round((l.valueSatang * take) / l.qty);
  return { next: { qty: l.qty - qty, valueSatang: l.valueSatang - valueOut }, valueDelta: -valueOut };
}

/** ปรับยอดจากการตรวจนับ: ตั้งปริมาณเป็นค่าที่นับได้ มูลค่าคิดตามต้นทุนเฉลี่ยเดิม */
export function adjustTo(l: Level, countedQty: number): { next: Level; qtyDelta: number; valueDelta: number } {
  if (!Number.isInteger(countedQty) || countedQty < 0) throw new StockError('ยอดที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ');
  const qtyDelta = countedQty - l.qty;
  if (qtyDelta === 0) return { next: l, qtyDelta: 0, valueDelta: 0 };
  const unit = avgCost(l);
  const nextValue = countedQty === 0 ? 0 : Math.round(unit * countedQty);
  return { next: { qty: countedQty, valueSatang: nextValue }, qtyDelta, valueDelta: nextValue - l.valueSatang };
}

/** ต้นทุนสูตรอาหารต่อจาน (สตางค์) จากต้นทุนเฉลี่ยของวัตถุดิบ */
export function recipeCost(lines: { qty: number; unitCost: number }[]): number {
  return Math.round(lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
}

/** รวมความต้องการวัตถุดิบจากรายการขาย: ผลรวมต่อวัตถุดิบ = Σ (ปริมาณในสูตร × จำนวนจาน) */
export function explodeBom(
  sold: { productId: string | null; qty: number }[],
  recipes: Map<string, { ingredientId: string; qty: number }[]>,
): Map<string, number> {
  const need = new Map<string, number>();
  for (const s of sold) {
    if (!s.productId) continue;
    for (const r of recipes.get(s.productId) ?? []) {
      need.set(r.ingredientId, (need.get(r.ingredientId) ?? 0) + r.qty * s.qty);
    }
  }
  return need;
}
