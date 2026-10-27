import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, cn, Empty, Input, Label, Modal } from '../../components/ui';
import { api } from '../../lib/api';
import { baht } from '../../lib/money';
import { fmtQty, INPUT_UNITS, toBase, UNIT_TH, type BaseUnit } from '../../lib/units';
import type { CostingRow, Ingredient, Movement, MovementType, Recipe } from '../../types';
import { useIngredients, useStockRefresh, useSubmit } from './shared';

// ---------------- สูตร & ต้นทุน ----------------
export function RecipesTab() {
  const costing = useQuery({ queryKey: ['costing'], queryFn: () => api<CostingRow[]>('/inventory/costing') });
  const [editing, setEditing] = useState<string | null>(null);

  if (costing.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (costing.isError) return <Empty>{(costing.error as Error).message}</Empty>;
  const rows = costing.data!;
  const noRecipe = rows.filter((r) => !r.hasRecipe).length;

  return (
    <div className="space-y-3">
      {noRecipe > 0 && <p className="text-sm text-stone-600">มี {noRecipe} เมนูที่ยังไม่มีสูตร — ขายได้ตามปกติแต่จะไม่หักวัตถุดิบและไม่มีต้นทุน</p>}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="px-4 py-2 font-normal">เมนู</th>
                <th className="px-4 py-2 text-right font-normal">ราคาขาย</th>
                <th className="px-4 py-2 text-right font-normal">ต้นทุน/จาน</th>
                <th className="px-4 py-2 text-right font-normal">กำไรขั้นต้น</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId} className="border-t border-stone-100">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    {!r.hasRecipe ? (
                      <Badge>ยังไม่มีสูตร</Badge>
                    ) : (
                      r.missingCost.length > 0 && <div className="text-xs text-amber-700">ยังไม่มีต้นทุน: {r.missingCost.join(', ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{baht(r.priceSatang)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{r.hasRecipe ? baht(r.costSatang) : '—'}</td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right tabular',
                      r.hasRecipe && r.missingCost.length > 0 && 'text-stone-400',
                      r.hasRecipe && !r.missingCost.length && r.marginPct < 30 && 'text-red-600',
                    )}
                    title={r.missingCost.length ? 'ต้นทุนยังไม่ครบ — กำไรจริงต่ำกว่านี้' : undefined}
                  >
                    {!r.hasRecipe ? '—' : r.missingCost.length ? `≤ ${r.marginPct}% (ต้นทุนไม่ครบ)` : `${baht(r.marginSatang)} · ${r.marginPct}%`}
                  </td>
                  <td className="px-2 py-2.5">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r.productId)}>
                      <Pencil size={14} /> สูตร
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-stone-500">ต้นทุนคิดจากต้นทุนเฉลี่ยของวัตถุดิบในสาขานี้ · กำไรขั้นต้นต่ำกว่า 30% แสดงเป็นสีแดง</p>
      {editing && <RecipeEditor productId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface RecipeLineDraft {
  key: number;
  ingredientId: string;
  qty: string;
  factor: number;
}
let k = 1;

function RecipeEditor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const ingredients = useIngredients();
  const recipe = useQuery({ queryKey: ['recipe', productId], queryFn: () => api<Recipe>(`/inventory/recipes/${productId}`) });
  const { busy, submit } = useSubmit();
  const [lines, setLines] = useState<RecipeLineDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (recipe.data && lines === null) {
      setLines(
        recipe.data.items.length
          ? recipe.data.items.map((i) => ({ key: k++, ingredientId: i.ingredientId, qty: String(i.qty), factor: 1 }))
          : [{ key: k++, ingredientId: '', qty: '', factor: 1 }],
      );
    }
  }, [recipe.data, lines]);

  const byId = new Map((ingredients.data ?? []).map((i) => [i.id, i]));
  const upd = (key: number, p: Partial<RecipeLineDraft>) => setLines((ls) => ls!.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function save() {
    const items: { ingredientId: string; qty: number }[] = [];
    for (const [i, l] of (lines ?? []).entries()) {
      if (!l.ingredientId && !l.qty) continue;
      const q = toBase(l.qty, l.factor);
      if (!l.ingredientId || q === null) return setError(`แถว ${i + 1}: ข้อมูลไม่ครบหรือไม่ถูกต้อง`);
      items.push({ ingredientId: l.ingredientId, qty: q });
    }
    setError(null);
    if (await submit(() => api(`/inventory/recipes/${productId}`, { method: 'PUT', body: { items } }), 'บันทึกสูตรแล้ว')) {
      qc.invalidateQueries({ queryKey: ['costing'] });
      qc.invalidateQueries({ queryKey: ['recipe', productId] });
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} title={`สูตร: ${recipe.data?.name ?? ''}`} wide>
      {!lines || !ingredients.data ? (
        <Empty>กำลังโหลด…</Empty>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">ปริมาณที่ใช้ต่อ 1 จาน — ระบบจะหักสต็อกอัตโนมัติเมื่อบิลถูกชำระ</p>
          {lines.map((l) => {
            const ing = byId.get(l.ingredientId);
            const units = ing ? INPUT_UNITS[ing.unit] : [{ label: '—', factor: 1 }];
            return (
              <div key={l.key} className="flex gap-2">
                <select
                  aria-label="วัตถุดิบ"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2"
                  value={l.ingredientId}
                  onChange={(e) => upd(l.key, { ingredientId: e.target.value, factor: 1 })}
                >
                  <option value="">เลือกวัตถุดิบ…</option>
                  {ingredients.data!.filter((i) => i.active || i.id === l.ingredientId).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
                <Input aria-label="ปริมาณ" className="w-24" inputMode="decimal" value={l.qty} onChange={(e) => upd(l.key, { qty: e.target.value })} />
                <select
                  aria-label="หน่วย"
                  className="h-10 rounded-lg border border-stone-300 bg-white px-1 text-sm"
                  value={l.factor}
                  onChange={(e) => upd(l.key, { factor: Number(e.target.value) })}
                >
                  {[...units].reverse().map((u) => (
                    <option key={u.label} value={u.factor}>
                      {u.label}
                    </option>
                  ))}
                </select>
                <button className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="ลบ">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines([...lines, { key: k++, ingredientId: '', qty: '', factor: 1 }])}>
            <Plus size={16} /> เพิ่มวัตถุดิบ
          </Button>
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <Button className="w-full" disabled={busy} onClick={save}>
            บันทึกสูตร
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ---------------- วัตถุดิบ ----------------
export function IngredientsTab() {
  const qc = useQueryClient();
  const ingredients = useIngredients();
  const refresh = useStockRefresh();
  const { busy, submit } = useSubmit();
  const [edit, setEdit] = useState<Partial<Ingredient> | null>(null);

  const done = () => {
    qc.invalidateQueries({ queryKey: ['ingredients'] });
    refresh();
    setEdit(null);
  };

  return (
    <Card>
      <div className="flex items-center border-b border-stone-200 p-4">
        <h2 className="font-semibold">วัตถุดิบ ({ingredients.data?.length ?? 0})</h2>
        <Button size="sm" className="ml-auto" onClick={() => setEdit({ unit: 'g', reorderLevel: 0, active: true })}>
          <Plus size={16} /> เพิ่มวัตถุดิบ
        </Button>
      </div>
      <ul className="divide-y divide-stone-100">
        {ingredients.data?.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={cn('font-medium', !i.active && 'text-stone-400 line-through')}>{i.name}</div>
              <div className="text-xs text-stone-500">
                หน่วย {UNIT_TH[i.unit]} · จุดสั่งซื้อ {fmtQty(i.reorderLevel, i.unit)}
                {i.sku && ` · ${i.sku}`}
              </div>
            </div>
            <button className="rounded-lg p-1.5 hover:bg-stone-100" onClick={() => setEdit(i)} aria-label={`แก้ไข ${i.name}`}>
              <Pencil size={16} />
            </button>
          </li>
        ))}
      </ul>
      {edit && <IngredientForm initial={edit} busy={busy} onClose={() => setEdit(null)} onSave={(body) => submit(() => (edit.id ? api(`/inventory/ingredients/${edit.id}`, { method: 'PATCH', body }) : api('/inventory/ingredients', { body })), 'บันทึกแล้ว').then((r) => r && done())} />}
    </Card>
  );
}

function IngredientForm({ initial, busy, onClose, onSave }: { initial: Partial<Ingredient>; busy: boolean; onClose: () => void; onSave: (b: object) => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [unit, setUnit] = useState<BaseUnit>(initial.unit ?? 'g');
  const [sku, setSku] = useState(initial.sku ?? '');
  const [reorder, setReorder] = useState(String(initial.reorderLevel ?? 0));
  const [active, setActive] = useState(initial.active ?? true);
  const reorderN = reorder.trim() === '0' ? 0 : toBase(reorder, 1);

  return (
    <Modal open onClose={onClose} title={initial.id ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reorderN === null) return;
          const base = { name: name.trim(), sku, reorderLevel: reorderN };
          onSave(initial.id ? { ...base, active } : { ...base, unit });
        }}
      >
        <div>
          <Label>ชื่อวัตถุดิบ</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>หน่วยฐาน</Label>
            <select disabled={!!initial.id} className="h-10 w-full rounded-lg border border-stone-300 bg-white px-2 disabled:bg-stone-100" value={unit} onChange={(e) => setUnit(e.target.value as BaseUnit)}>
              <option value="g">กรัม (g)</option>
              <option value="ml">มิลลิลิตร (ml)</option>
              <option value="pcs">ชิ้น (pcs)</option>
            </select>
          </div>
          <div>
            <Label>จุดสั่งซื้อ ({UNIT_TH[unit]})</Label>
            <Input inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>SKU (ไม่บังคับ)</Label>
          <Input value={sku} onChange={(e) => setSku(e.target.value)} />
        </div>
        {initial.id && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brand-700" />
            ใช้งานอยู่
          </label>
        )}
        {initial.id && <p className="text-xs text-stone-500">เปลี่ยนหน่วยฐานไม่ได้ เพราะประวัติและสูตรอ้างอิงหน่วยเดิม</p>}
        <Button type="submit" className="w-full" disabled={busy || !name.trim() || reorderN === null}>
          บันทึก
        </Button>
      </form>
    </Modal>
  );
}

// ---------------- ประวัติ ----------------
export const MOVE_TH: Record<MovementType, string> = {
  receive: 'รับเข้า',
  issue: 'เบิกใช้',
  waste: 'ของเสีย',
  transfer_out: 'โอนออก',
  transfer_in: 'รับโอน',
  sale: 'ขาย',
  adjust: 'ปรับจากตรวจนับ',
};

export function HistoryTab() {
  const ingredients = useIngredients();
  const [ingredientId, setIngredientId] = useState('');
  const [type, setType] = useState<MovementType | ''>('');
  const qs = new URLSearchParams({ limit: '200', ...(ingredientId ? { ingredientId } : {}), ...(type ? { type } : {}) });
  const mv = useQuery({ queryKey: ['movements', ingredientId, type], queryFn: () => api<Movement[]>(`/inventory/movements?${qs}`) });

  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-stone-200 p-3">
        <select aria-label="กรองวัตถุดิบ" className="h-10 rounded-lg border border-stone-300 bg-white px-2" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">ทุกวัตถุดิบ</option>
          {ingredients.data?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select aria-label="กรองประเภท" className="h-10 rounded-lg border border-stone-300 bg-white px-2" value={type} onChange={(e) => setType(e.target.value as MovementType | '')}>
          <option value="">ทุกประเภท</option>
          {Object.entries(MOVE_TH).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {mv.isLoading ? (
        <Empty>กำลังโหลด…</Empty>
      ) : !mv.data?.length ? (
        <Empty>ยังไม่มีประวัติ</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="px-4 py-2 font-normal">เวลา</th>
                <th className="px-4 py-2 font-normal">รายการ</th>
                <th className="px-4 py-2 text-right font-normal">ปริมาณ</th>
                <th className="hidden px-4 py-2 text-right font-normal sm:table-cell">มูลค่า</th>
                <th className="hidden px-4 py-2 text-right font-normal md:table-cell">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {mv.data.map((m) => (
                <tr key={m.id} className="border-t border-stone-100 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-stone-500">
                    {new Date(m.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                  </td>
                  <td className="px-4 py-2">
                    <div>
                      <span className="font-medium">{m.ingredient.name}</span> · {MOVE_TH[m.type]}
                    </div>
                    {(m.reason || m.supplier) && <div className="text-xs text-stone-500">{[m.supplier, m.reason].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td className={cn('px-4 py-2 text-right whitespace-nowrap tabular', m.qtyDelta < 0 ? 'text-red-600' : 'text-green-700')}>
                    {m.qtyDelta > 0 ? '+' : ''}
                    {fmtQty(m.qtyDelta, m.ingredient.unit)}
                  </td>
                  <td className="hidden px-4 py-2 text-right tabular sm:table-cell">{baht(m.valueDeltaSatang)}</td>
                  <td className="hidden px-4 py-2 text-right text-stone-500 tabular md:table-cell">{fmtQty(m.balanceQty, m.ingredient.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
