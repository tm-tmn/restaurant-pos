import { calcTotals, settlePayments, MoneyError } from './money';

describe('calcTotals', () => {
  it('รวมยอดและหักส่วนลด', () => {
    const r = calcTotals(
      [
        { unitPriceSatang: 6000, qty: 2 },
        { unitPriceSatang: 2500, qty: 1 },
      ],
      500,
    );
    expect(r).toEqual({ subtotal: 14500, discount: 500, total: 14000 });
  });

  it('ปฏิเสธจำนวนไม่ใช่จำนวนเต็มบวก', () => {
    expect(() => calcTotals([{ unitPriceSatang: 100, qty: 0 }])).toThrow(MoneyError);
    expect(() => calcTotals([{ unitPriceSatang: 100, qty: 1.5 }])).toThrow(MoneyError);
  });

  it('ปฏิเสธส่วนลดเกินยอดรวม', () => {
    expect(() => calcTotals([{ unitPriceSatang: 100, qty: 1 }], 200)).toThrow(MoneyError);
  });

  it('ปฏิเสธราคาทศนิยม (ต้องเป็นสตางค์จำนวนเต็ม)', () => {
    expect(() => calcTotals([{ unitPriceSatang: 99.5, qty: 1 }])).toThrow(MoneyError);
  });
});

describe('settlePayments', () => {
  it('เงินสดคิดเงินทอน', () => {
    const [p] = settlePayments(14000, [{ method: 'cash', amountSatang: 14000, receivedSatang: 20000 }]);
    expect(p.changeSatang).toBe(6000);
  });

  it('จ่ายแยกหลายวิธีรวมเท่ายอดบิล', () => {
    const r = settlePayments(10000, [
      { method: 'promptpay', amountSatang: 6000 },
      { method: 'cash', amountSatang: 4000, receivedSatang: 5000 },
    ]);
    expect(r[1].changeSatang).toBe(1000);
    expect(r[0].changeSatang).toBe(0);
  });

  it('ปฏิเสธเมื่อยอดรวมไม่ตรงบิล', () => {
    expect(() => settlePayments(10000, [{ method: 'promptpay', amountSatang: 9000 }])).toThrow(MoneyError);
    expect(() => settlePayments(10000, [{ method: 'promptpay', amountSatang: 11000 }])).toThrow(MoneyError);
  });

  it('ปฏิเสธเงินสดที่รับน้อยกว่ายอด', () => {
    expect(() =>
      settlePayments(10000, [{ method: 'cash', amountSatang: 10000, receivedSatang: 9000 }]),
    ).toThrow(MoneyError);
  });

  it('ปฏิเสธเมื่อไม่มีรายการชำระ', () => {
    expect(() => settlePayments(0, [])).toThrow(MoneyError);
  });
});
