import { adjustTo, avgCost, consume, explodeBom, receive, recipeCost, StockError } from './costing';

describe('receive (ถัวเฉลี่ย)', () => {
  it('รับเข้าสองล็อตราคาต่างกัน → ต้นทุนเฉลี่ยถ่วงน้ำหนัก', () => {
    let l = receive({ qty: 0, valueSatang: 0 }, 1000, 18000).next; // หมู 1kg 180 บาท
    l = receive(l, 1000, 22000).next; // อีก 1kg 220 บาท
    expect(l).toEqual({ qty: 2000, valueSatang: 40000 });
    expect(avgCost(l)).toBe(20); // 20 สตางค์/กรัม
  });

  it('รับเข้าหลังสต็อกติดลบ: ชดเชยส่วนที่ติดลบก่อน', () => {
    const r = receive({ qty: -200, valueSatang: 0 }, 1000, 20000);
    expect(r.next.qty).toBe(800);
    expect(r.next.valueSatang).toBe(16000); // 800/1000 ของราคาที่จ่าย
  });

  it('ปฏิเสธปริมาณ/ราคาไม่ถูกต้อง', () => {
    expect(() => receive({ qty: 0, valueSatang: 0 }, 0, 100)).toThrow(StockError);
    expect(() => receive({ qty: 0, valueSatang: 0 }, 1.5, 100)).toThrow(StockError);
    expect(() => receive({ qty: 0, valueSatang: 0 }, 10, -1)).toThrow(StockError);
  });
});

describe('consume', () => {
  const lvl = { qty: 2000, valueSatang: 40000 };

  it('ตัดตามต้นทุนเฉลี่ย', () => {
    const r = consume(lvl, 150, false);
    expect(r.next).toEqual({ qty: 1850, valueSatang: 37000 });
    expect(r.valueDelta).toBe(-3000);
  });

  it('ตัดหมดพอดีไม่เหลือเศษมูลค่า', () => {
    const l = { qty: 3, valueSatang: 100 };
    const a = consume(l, 1, false).next;
    const b = consume(a, 2, false).next;
    expect(b).toEqual({ qty: 0, valueSatang: 0 });
  });

  it('เบิก/ของเสียเกินสต็อก → ปฏิเสธ', () => {
    expect(() => consume(lvl, 2001, false)).toThrow(StockError);
  });

  it('การขายเกินสต็อก → ยอมให้ติดลบ มูลค่าเป็น 0', () => {
    const r = consume(lvl, 2500, true);
    expect(r.next).toEqual({ qty: -500, valueSatang: 0 });
    expect(r.valueDelta).toBe(-40000);
    const r2 = consume(r.next, 100, true);
    expect(r2.next).toEqual({ qty: -600, valueSatang: 0 });
    expect(r2.valueDelta).toBe(0);
  });
});

describe('adjustTo (ตรวจนับ)', () => {
  it('นับได้น้อยกว่าระบบ → ลดมูลค่าตามต้นทุนเฉลี่ย', () => {
    const r = adjustTo({ qty: 2000, valueSatang: 40000 }, 1900);
    expect(r).toEqual({ next: { qty: 1900, valueSatang: 38000 }, qtyDelta: -100, valueDelta: -2000 });
  });
  it('นับได้ 0 → มูลค่า 0', () => {
    expect(adjustTo({ qty: 10, valueSatang: 333 }, 0).next).toEqual({ qty: 0, valueSatang: 0 });
  });
  it('ไม่ต่าง → ไม่มีการเปลี่ยนแปลง', () => {
    expect(adjustTo({ qty: 10, valueSatang: 333 }, 10).qtyDelta).toBe(0);
  });
});

describe('BOM', () => {
  it('รวมวัตถุดิบจากหลายเมนู', () => {
    const recipes = new Map([
      ['kaprao', [{ ingredientId: 'rice', qty: 200 }, { ingredientId: 'pork', qty: 150 }]],
      ['friedrice', [{ ingredientId: 'rice', qty: 250 }]],
    ]);
    const need = explodeBom(
      [
        { productId: 'kaprao', qty: 2 },
        { productId: 'friedrice', qty: 1 },
        { productId: 'water', qty: 3 }, // ไม่มีสูตร → ไม่หัก
        { productId: null, qty: 1 },
      ],
      recipes,
    );
    expect(Object.fromEntries(need)).toEqual({ rice: 650, pork: 300 });
  });

  it('ต้นทุนสูตร', () => {
    // ข้าว 200g × 4 สตางค์ + หมู 150g × 20 สตางค์ = 800 + 3000
    expect(recipeCost([{ qty: 200, unitCost: 4 }, { qty: 150, unitCost: 20 }])).toBe(3800);
  });
});
