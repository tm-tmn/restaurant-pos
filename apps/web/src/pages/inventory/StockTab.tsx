import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Card, cn, Empty, Input } from '../../components/ui';
import { api } from '../../lib/api';
import { baht } from '../../lib/money';
import { fmtQty, fmtUnitCost } from '../../lib/units';
import type { ExpiringLot } from '../../types';
import { useLevels } from './shared';

export function StockTab() {
  const levels = useLevels();
  const expiring = useQuery({ queryKey: ['expiring'], queryFn: () => api<ExpiringLot[]>('/inventory/expiring?days=7') });
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (levels.data ?? []).filter((r) => (!onlyLow || r.low) && (!s || r.name.toLowerCase().includes(s) || r.sku?.toLowerCase().includes(s)));
  }, [levels.data, q, onlyLow]);

  if (levels.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (levels.isError) return <Empty>{(levels.error as Error).message}</Empty>;
  const all = levels.data!;
  const lowCount = all.filter((r) => r.low).length;
  const totalValue = all.reduce((s, r) => s + Math.max(0, r.valueSatang), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm text-stone-500">มูลค่าสต็อกคงเหลือ</div>
          <div className="mt-1 text-2xl font-semibold text-brand-700 tabular">{baht(totalValue)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-stone-500">วัตถุดิบทั้งหมด</div>
          <div className="mt-1 text-xl font-semibold tabular">{all.length}</div>
        </Card>
        <button onClick={() => setOnlyLow((v) => !v)} className="text-left">
          <Card className={cn('h-full p-4', onlyLow && 'ring-2 ring-amber-400')}>
            <div className="text-sm text-stone-500">ต่ำกว่าจุดสั่งซื้อ</div>
            <div className={cn('mt-1 text-xl font-semibold tabular', lowCount > 0 && 'text-amber-700')}>{lowCount}</div>
          </Card>
        </button>
      </div>

      {(expiring.data?.length ?? 0) > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-900">
            <CalendarClock size={18} /> ล็อตที่ใกล้หมดอายุ (7 วัน)
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {expiring.data!.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>
                  {e.name} · รับเข้า {fmtQty(e.receivedQty, e.unit)}
                </span>
                <span className="shrink-0 font-medium">หมดอายุ {new Date(e.expiryDate).toLocaleDateString('th-TH')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" size={16} />
            <Input className="pl-9" placeholder="ค้นหาวัตถุดิบ / SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
            เฉพาะที่ต้องสั่งซื้อ
          </label>
        </div>
        {rows.length === 0 ? (
          <Empty>{all.length === 0 ? 'ยังไม่มีวัตถุดิบ — เพิ่มได้ที่แท็บ "วัตถุดิบ"' : 'ไม่พบรายการ'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="px-4 py-2 font-normal">วัตถุดิบ</th>
                  <th className="px-4 py-2 text-right font-normal">คงเหลือ</th>
                  <th className="hidden px-4 py-2 text-right font-normal sm:table-cell">จุดสั่งซื้อ</th>
                  <th className="hidden px-4 py-2 text-right font-normal md:table-cell">ต้นทุนเฉลี่ย</th>
                  <th className="px-4 py-2 text-right font-normal">มูลค่า</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ingredientId} className="border-t border-stone-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {r.negative ? (
                          <Badge tone="red">
                            <AlertTriangle size={12} className="mr-1" />
                            ติดลบ
                          </Badge>
                        ) : (
                          r.low && <Badge tone="amber">ต้องสั่งซื้อ</Badge>
                        )}
                      </div>
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular', r.negative && 'text-red-600', r.low && !r.negative && 'text-amber-700')}>{fmtQty(r.qty, r.unit)}</td>
                    <td className="hidden px-4 py-2.5 text-right text-stone-500 tabular sm:table-cell">{fmtQty(r.reorderLevel, r.unit)}</td>
                    <td className="hidden px-4 py-2.5 text-right text-stone-500 tabular md:table-cell">{fmtUnitCost(r.avgCostSatang, r.unit)}</td>
                    <td className="px-4 py-2.5 text-right tabular">{baht(r.valueSatang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {all.some((r) => r.negative) && (
        <p className="text-sm text-stone-500">
          "ติดลบ" = ขายไปมากกว่าที่บันทึกรับเข้า (ระบบไม่บล็อกการขาย) — ให้รับเข้าย้อนหลังหรือตรวจนับเพื่อปรับยอด
        </p>
      )}
    </div>
  );
}
