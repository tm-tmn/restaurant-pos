import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, cn, Empty, Input, Label } from '../../components/ui';
import { api } from '../../lib/api';
import { baht, parseBahtToSatang } from '../../lib/money';
import { fmtQty, toBase, UNIT_TH } from '../../lib/units';
import { useAuth } from '../../store/auth';
import type { BranchLite } from '../../types';
import { emptyLine, LinesEditor, parseLines, useIngredients, useLevels, useStockRefresh, useSubmit, type LineDraft } from './shared';

// ---------------- รับเข้า ----------------
export function ReceiveTab() {
  const ingredients = useIngredients();
  const refresh = useStockRefresh();
  const { busy, submit } = useSubmit();
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + (parseBahtToSatang(l.cost || '') ?? 0), 0);

  async function save() {
    const r = parseLines(lines, true);
    if ('error' in r) return setError(r.error ?? null);
    setError(null);
    const ok = await submit(() => api('/inventory/receive', { body: { supplier: supplier || undefined, note: note || undefined, items: r.items } }), 'บันทึกรับเข้าแล้ว');
    if (ok) {
      setLines([emptyLine()]);
      setNote('');
      refresh();
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>ผู้ขาย / ร้านที่ซื้อ</Label>
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="เช่น ตลาดไท, แม็คโคร" />
        </div>
        <div>
          <Label>หมายเหตุ / เลขที่ใบส่งของ</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <p className="text-sm text-stone-500">กรอก "ราคารวม" ที่จ่ายจริงของแต่ละรายการ ระบบจะคำนวณต้นทุนเฉลี่ยให้อัตโนมัติ · วันหมดอายุไม่บังคับ</p>
      {ingredients.data ? <LinesEditor lines={lines} setLines={setLines} ingredients={ingredients.data} withCost /> : <Empty>กำลังโหลด…</Empty>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
        <span className="text-stone-600">
          รวม <span className="text-xl font-semibold text-stone-900 tabular">{baht(total)}</span>
        </span>
        <Button disabled={busy} onClick={save}>
          บันทึกรับเข้า
        </Button>
      </div>
    </Card>
  );
}

// ---------------- เบิกใช้ / ของเสีย ----------------
const WASTE_REASONS = ['หมดอายุ', 'เน่าเสีย', 'ทำหก/ตกหล่น', 'ทำผิดสูตร', 'ลูกค้าตีกลับ'];

export function ConsumeTab() {
  const ingredients = useIngredients();
  const levels = useLevels();
  const refresh = useStockRefresh();
  const { busy, submit } = useSubmit();
  const [kind, setKind] = useState<'waste' | 'issue'>('waste');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const stock = useMemo(() => new Map((levels.data ?? []).map((r) => [r.ingredientId, r])), [levels.data]);

  async function save() {
    const r = parseLines(lines, false);
    if ('error' in r) return setError(r.error ?? null);
    if (reason.trim().length < 2) return setError('ระบุเหตุผล');
    setError(null);
    const res = await submit(
      () => api<{ valueSatang: number }>(`/inventory/${kind}`, { body: { reason: reason.trim(), items: r.items } }),
      kind === 'waste' ? 'บันทึกของเสียแล้ว' : 'บันทึกการเบิกแล้ว',
    );
    if (res) {
      setLines([emptyLine()]);
      setReason('');
      refresh();
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex gap-1 rounded-xl bg-stone-100 p-1">
        {(
          [
            ['waste', 'ของเสีย / หมดอายุ'],
            ['issue', 'เบิกใช้ (ไม่ผ่านการขาย)'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} className={cn('flex-1 rounded-lg py-2 text-sm font-medium', kind === k ? 'bg-white shadow-sm' : 'text-stone-600')}>
            {label}
          </button>
        ))}
      </div>
      <div>
        <Label>เหตุผล</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'waste' ? 'เช่น หมดอายุ' : 'เช่น ทำน้ำซุปตั้งต้น, อาหารพนักงาน'} />
        {kind === 'waste' && (
          <div className="mt-2 flex flex-wrap gap-2">
            {WASTE_REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)} className="rounded-full bg-stone-100 px-3 py-1 text-sm hover:bg-stone-200">
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
      {ingredients.data ? <LinesEditor lines={lines} setLines={setLines} ingredients={ingredients.data} stock={stock} /> : <Empty>กำลังโหลด…</Empty>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end border-t border-stone-200 pt-4">
        <Button variant={kind === 'waste' ? 'danger' : 'primary'} disabled={busy} onClick={save}>
          {kind === 'waste' ? 'บันทึกของเสีย' : 'บันทึกการเบิก'}
        </Button>
      </div>
    </Card>
  );
}

// ---------------- โอนระหว่างสาขา ----------------
export function TransferTab() {
  const ingredients = useIngredients();
  const levels = useLevels();
  const myBranch = useAuth((s) => s.branch);
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<BranchLite[]>('/branches') });
  const refresh = useStockRefresh();
  const { busy, submit } = useSubmit();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const stock = useMemo(() => new Map((levels.data ?? []).map((r) => [r.ingredientId, r])), [levels.data]);
  const targets = (branches.data ?? []).filter((b) => b.id !== myBranch?.id);

  async function save() {
    if (!to) return setError('เลือกสาขาปลายทาง');
    const r = parseLines(lines, false);
    if ('error' in r) return setError(r.error ?? null);
    setError(null);
    if (await submit(() => api('/inventory/transfer', { body: { toBranchId: to, note: note || undefined, items: r.items } }), 'โอนสต็อกแล้ว')) {
      setLines([emptyLine()]);
      setNote('');
      refresh();
    }
  }

  if (branches.isSuccess && targets.length === 0) {
    return (
      <Card className="p-4">
        <Empty>มีสาขาเดียว — เจ้าของร้านเพิ่มสาขาได้ที่ จัดการ → ตั้งค่าร้าน</Empty>
      </Card>
    );
  }
  return (
    <Card className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>จาก</Label>
          <Input disabled value={myBranch?.name ?? ''} />
        </div>
        <div>
          <Label>ไปยังสาขา</Label>
          <select className="h-10 w-full rounded-lg border border-stone-300 bg-white px-2" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">เลือกสาขา…</option>
            {targets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} · {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <Label>หมายเหตุ</Label>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {ingredients.data ? <LinesEditor lines={lines} setLines={setLines} ingredients={ingredients.data} stock={stock} /> : <Empty>กำลังโหลด…</Empty>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-stone-500">มูลค่าที่โอนคิดตามต้นทุนเฉลี่ยของสาขาต้นทาง และรับเข้าที่ปลายทางทันที</p>
      <div className="flex justify-end border-t border-stone-200 pt-4">
        <Button disabled={busy} onClick={save}>
          ยืนยันการโอน
        </Button>
      </div>
    </Card>
  );
}

// ---------------- ตรวจนับสต็อก ----------------
export function CountTab() {
  const levels = useLevels();
  const refresh = useStockRefresh();
  const { busy, submit } = useSubmit();
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ linesCounted: number; linesAdjusted: number; valueDeltaSatang: number } | null>(null);

  if (levels.isLoading) return <Empty>กำลังโหลด…</Empty>;
  const rows = levels.data ?? [];
  const entered = rows.filter((r) => (counted[r.ingredientId] ?? '').trim() !== '');
  const parsed = entered.map((r) => {
    const raw = counted[r.ingredientId].trim();
    const v = raw === '0' ? 0 : toBase(raw, 1);
    return { r, v };
  });
  const invalid = parsed.find((p) => p.v === null);

  async function save() {
    if (invalid || parsed.length === 0) return;
    const res = await submit(
      () =>
        api<{ linesCounted: number; linesAdjusted: number; valueDeltaSatang: number }>('/inventory/counts', {
          body: { note: note || undefined, lines: parsed.map((p) => ({ ingredientId: p.r.ingredientId, countedQty: p.v! })) },
        }),
      'บันทึกผลตรวจนับแล้ว',
    );
    if (res) {
      setResult(res);
      setCounted({});
      refresh();
    }
  }

  return (
    <div className="space-y-4">
      {result && (
        <Card className="p-4">
          นับ {result.linesCounted} รายการ · ปรับยอด {result.linesAdjusted} รายการ · ผลต่างมูลค่า{' '}
          <span className={cn('font-semibold tabular', result.valueDeltaSatang < 0 ? 'text-red-600' : 'text-green-700')}>{baht(result.valueDeltaSatang)}</span>
        </Card>
      )}
      <Card>
        <div className="border-b border-stone-200 p-4 text-sm text-stone-600">
          กรอกยอดที่นับได้จริง <b>เป็นหน่วยฐาน</b> (กรัม / มล. / ชิ้น) เฉพาะรายการที่นับ — ช่องว่างจะไม่ถูกปรับ
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="px-4 py-2 font-normal">วัตถุดิบ</th>
                <th className="px-4 py-2 text-right font-normal">ในระบบ</th>
                <th className="px-4 py-2 font-normal">นับได้</th>
                <th className="px-4 py-2 text-right font-normal">ผลต่าง</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const raw = (counted[r.ingredientId] ?? '').trim();
                const v = raw === '' ? null : raw === '0' ? 0 : toBase(raw, 1);
                const diff = v === null ? null : v - r.qty;
                return (
                  <tr key={r.ingredientId} className="border-t border-stone-100">
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2 text-right text-stone-500 tabular">{fmtQty(r.qty, r.unit)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`นับได้ ${r.name}`}
                          inputMode="numeric"
                          className={cn('h-9 w-28', raw !== '' && v === null && 'border-red-400')}
                          value={counted[r.ingredientId] ?? ''}
                          onChange={(e) => setCounted({ ...counted, [r.ingredientId]: e.target.value })}
                        />
                        <span className="text-xs text-stone-500">{UNIT_TH[r.unit]}</span>
                      </div>
                    </td>
                    <td className={cn('px-4 py-2 text-right tabular', diff !== null && diff < 0 && 'text-red-600', diff !== null && diff > 0 && 'text-green-700')}>
                      {diff === null ? '' : diff === 0 ? 'ตรง' : `${diff > 0 ? '+' : ''}${diff.toLocaleString('th-TH')}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 p-4">
          <Input className="max-w-xs" placeholder="หมายเหตุ เช่น นับสิ้นเดือน" value={note} onChange={(e) => setNote(e.target.value)} />
          {invalid && <span className="text-sm text-red-600">ตัวเลขไม่ถูกต้อง: {invalid.r.name}</span>}
          <Button className="ml-auto" disabled={busy || !!invalid || parsed.length === 0} onClick={save}>
            บันทึกผลตรวจนับ ({parsed.length})
          </Button>
        </div>
      </Card>
    </div>
  );
}
