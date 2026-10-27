import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Input } from '../../components/ui';
import { api } from '../../lib/api';
import { parseBahtToSatang } from '../../lib/money';
import { INPUT_UNITS, toBase } from '../../lib/units';
import { useToast } from '../../store/toast';
import type { Ingredient, StockRow } from '../../types';

export const useIngredients = () =>
  useQuery({ queryKey: ['ingredients'], queryFn: () => api<Ingredient[]>('/inventory/ingredients') });
export const useLevels = () => useQuery({ queryKey: ['stock-levels'], queryFn: () => api<StockRow[]>('/inventory/levels') });

/** invalidate ทุกอย่างที่ขึ้นกับสต็อกหลังบันทึก */
export function useStockRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['stock-levels', 'movements', 'expiring', 'costing', 'report']) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useSubmit() {
  const toast = useToast((s) => s.show);
  const [busy, setBusy] = useState(false);
  async function submit<T>(fn: () => Promise<T>, ok: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const r = await fn();
      toast(ok);
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return { busy, submit };
}

export interface LineDraft {
  key: number;
  ingredientId: string;
  qty: string;
  factor: number;
  cost: string; // บาท (รวมทั้งรายการ)
  expiry: string;
}
let keySeq = 1;
export const emptyLine = (): LineDraft => ({ key: keySeq++, ingredientId: '', qty: '', factor: 1, cost: '', expiry: '' });

/** ตรวจและแปลงรายการเป็น payload; คืน error ข้อความแรกที่พบ */
export function parseLines(lines: LineDraft[], withCost: boolean) {
  const out: { ingredientId: string; qty: number; totalCostSatang?: number; expiryDate?: string }[] = [];
  for (const [i, l] of lines.entries()) {
    if (!l.ingredientId && !l.qty) continue;
    const n = i + 1;
    if (!l.ingredientId) return { error: `แถว ${n}: เลือกวัตถุดิบ` };
    const qty = toBase(l.qty, l.factor);
    if (qty === null) return { error: `แถว ${n}: ปริมาณไม่ถูกต้อง` };
    const item: (typeof out)[number] = { ingredientId: l.ingredientId, qty };
    if (withCost) {
      const c = parseBahtToSatang(l.cost || '');
      if (c === null) return { error: `แถว ${n}: ราคารวมไม่ถูกต้อง` };
      item.totalCostSatang = c;
      if (l.expiry) item.expiryDate = l.expiry;
    }
    out.push(item);
  }
  if (out.length === 0) return { error: 'ยังไม่มีรายการ' };
  return { items: out };
}

/** ตารางกรอกรายการวัตถุดิบ ใช้ร่วมกันในหน้า รับเข้า / เบิก / ของเสีย / โอน */
export function LinesEditor({
  lines,
  setLines,
  ingredients,
  withCost,
  stock,
}: {
  lines: LineDraft[];
  setLines: (l: LineDraft[]) => void;
  ingredients: Ingredient[];
  withCost?: boolean;
  stock?: Map<string, StockRow>;
}) {
  const active = ingredients.filter((i) => i.active);
  const byId = new Map(active.map((i) => [i.id, i]));
  const update = (key: number, patch: Partial<LineDraft>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-2">
      {lines.map((l) => {
        const ing = byId.get(l.ingredientId);
        const units = ing ? INPUT_UNITS[ing.unit] : [{ label: '—', factor: 1 }];
        const have = ing && stock?.get(ing.id);
        return (
          <div key={l.key} className="relative grid grid-cols-2 gap-2 rounded-xl border border-stone-200 p-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
            <select
              aria-label="วัตถุดิบ"
              className="col-span-2 mr-11 h-10 min-w-0 rounded-lg border border-stone-300 bg-white px-2 sm:col-span-1 sm:mr-0"
              value={l.ingredientId}
              onChange={(e) => {
                const next = byId.get(e.target.value);
                update(l.key, { ingredientId: e.target.value, factor: next ? INPUT_UNITS[next.unit][0].factor : 1 });
              }}
            >
              <option value="">เลือกวัตถุดิบ…</option>
              {active.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <div className="col-span-2 flex gap-1 sm:col-span-1">
              <Input aria-label="ปริมาณ" inputMode="decimal" placeholder="ปริมาณ" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              <select
                aria-label="หน่วย"
                className="h-10 rounded-lg border border-stone-300 bg-white px-1 text-sm"
                value={l.factor}
                onChange={(e) => update(l.key, { factor: Number(e.target.value) })}
              >
                {units.map((u) => (
                  <option key={u.label} value={u.factor}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            {withCost ? (
              <>
                <Input aria-label="ราคารวม (บาท)" inputMode="decimal" placeholder="ราคารวม ฿" value={l.cost} onChange={(e) => update(l.key, { cost: e.target.value })} />
                <Input aria-label="วันหมดอายุ" type="date" value={l.expiry} onChange={(e) => update(l.key, { expiry: e.target.value })} />
              </>
            ) : (
              <div className="col-span-2 self-center text-xs text-stone-500 sm:col-span-2">
                {have ? `คงเหลือ ${have.qty.toLocaleString('th-TH')} ${have.unit === 'pcs' ? 'ชิ้น' : have.unit === 'g' ? 'กรัม' : 'มล.'}` : ''}
              </div>
            )}
            <button
              className="absolute top-2 right-2 rounded-lg p-2.5 text-stone-400 hover:bg-red-50 hover:text-red-600 sm:static"
              onClick={() => setLines(lines.length > 1 ? lines.filter((x) => x.key !== l.key) : [emptyLine()])}
              aria-label="ลบแถว"
            >
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>
        <Plus size={16} /> เพิ่มแถว
      </Button>
    </div>
  );
}
