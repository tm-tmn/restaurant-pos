/**
 * ตรรกะเงินทั้งหมดใช้จำนวนเต็มหน่วย "สตางค์" (1 บาท = 100 สตางค์) เพื่อเลี่ยงปัญหาทศนิยม
 */

export interface LineInput {
  unitPriceSatang: number;
  qty: number;
}

export interface PaymentInput {
  method: 'cash' | 'promptpay' | 'card';
  /** ยอดที่ตัดบิลด้วยวิธีนี้ */
  amountSatang: number;
  /** เฉพาะเงินสด: ยอดที่รับมาจริง */
  receivedSatang?: number;
  reference?: string;
}

export interface SettledPayment extends PaymentInput {
  receivedSatang: number;
  changeSatang: number;
}

export class MoneyError extends Error {}

/** เพดานยอดต่อบิล 10 ล้านบาท — คอลัมน์เงินเป็น int (สูงสุด ~21.4 ล้านบาท) จึงต้องกันไว้ก่อนถึงฐานข้อมูล */
export const MAX_BILL_SATANG = 1_000_000_000;
/** เพดานราคาต่อหน่วย 1 ล้านบาท */
export const MAX_UNIT_PRICE_SATANG = 100_000_000;

function assertInt(n: number, label: string) {
  if (!Number.isInteger(n) || n < 0) {
    throw new MoneyError(`${label} ต้องเป็นจำนวนเต็มสตางค์ที่ไม่ติดลบ`);
  }
}

export function calcTotals(lines: LineInput[], discountSatang = 0) {
  assertInt(discountSatang, 'ส่วนลด');
  let subtotal = 0;
  for (const l of lines) {
    assertInt(l.unitPriceSatang, 'ราคาต่อหน่วย');
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new MoneyError('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0');
    }
    subtotal += l.unitPriceSatang * l.qty;
  }
  if (subtotal > MAX_BILL_SATANG) {
    throw new MoneyError('ยอดบิลเกินขีดจำกัดของระบบ (10 ล้านบาท)');
  }
  if (discountSatang >= subtotal && subtotal > 0) {
    throw new MoneyError('ส่วนลดต้องน้อยกว่ายอดรวม');
  }
  return { subtotal, discount: discountSatang, total: subtotal - discountSatang };
}

/**
 * ตรวจรายการชำระเงินให้ครบยอดบิล และคำนวณเงินทอน
 * - ยอดรวมของ amountSatang ต้องเท่ากับยอดบิลพอดี
 * - เงินทอนเกิดได้เฉพาะเงินสด (receivedSatang >= amountSatang)
 */
export function settlePayments(total: number, payments: PaymentInput[]): SettledPayment[] {
  if (payments.length === 0) throw new MoneyError('ต้องมีรายการชำระเงินอย่างน้อย 1 รายการ');
  let sum = 0;
  const settled = payments.map((p): SettledPayment => {
    assertInt(p.amountSatang, 'ยอดชำระ');
    sum += p.amountSatang;
    if (p.method === 'cash') {
      const received = p.receivedSatang ?? p.amountSatang;
      assertInt(received, 'เงินที่รับ');
      if (received < p.amountSatang) throw new MoneyError('เงินสดที่รับน้อยกว่ายอดชำระ');
      return { ...p, receivedSatang: received, changeSatang: received - p.amountSatang };
    }
    return { ...p, receivedSatang: p.amountSatang, changeSatang: 0 };
  });
  if (sum !== total) {
    throw new MoneyError(`ยอดชำระรวม (${sum}) ไม่ตรงกับยอดบิล (${total})`);
  }
  return settled;
}
