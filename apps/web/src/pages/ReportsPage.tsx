import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, Empty, Input } from '../components/ui';
import { api } from '../lib/api';
import { baht } from '../lib/money';
import type { DailyReport } from '../types';

const METHOD_TH = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร' } as const;
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export function ReportsPage() {
  const [date, setDate] = useState(today);
  const r = useQuery({ queryKey: ['report', date], queryFn: () => api<DailyReport>(`/reports/daily?date=${date}`) });

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">รายงานยอดขายรายวัน</h1>
        <Input type="date" className="ml-auto w-44" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>

      {r.isLoading ? (
        <Empty>กำลังโหลด…</Empty>
      ) : r.isError ? (
        <Empty>{(r.error as Error).message}</Empty>
      ) : (
        <Body d={r.data!} />
      )}
    </div>
  );
}

function Body({ d }: { d: DailyReport }) {
  const hours = Array.from({ length: 24 }, (_, h) => d.hourly.find((x) => x.hour === h) ?? { hour: h, orders: 0, salesSatang: 0 });
  const active = hours.filter((h) => h.orders > 0);
  const span = active.length ? hours.slice(Math.max(0, active[0].hour - 1), Math.min(24, active[active.length - 1].hour + 2)) : [];
  const maxH = Math.max(1, ...span.map((h) => h.salesSatang));
  const maxTop = Math.max(1, ...d.topProducts.map((p) => p.salesSatang));
  const methodTotal = d.byMethod.reduce((s, m) => s + m.amountSatang, 0) || 1;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="ยอดขายสุทธิ" value={baht(d.salesSatang)} big />
        <Stat label="จำนวนบิล" value={d.orders.toLocaleString('th-TH')} />
        <Stat label="เฉลี่ยต่อบิล" value={baht(d.avgOrderSatang)} />
        <Stat label="ส่วนลด / ยกเลิก" value={`${baht(d.discountSatang)} · ${d.voidedOrders + d.voidedItems} ครั้ง`} />
      </div>

      <Card className="p-4">
        <h2 className="mb-1 font-semibold">ยอดขายรายชั่วโมง</h2>
        <p className="mb-4 text-sm text-stone-500">บาท ตามเวลาที่ชำระเงิน</p>
        {span.length === 0 ? (
          <Empty>ยังไม่มียอดขายในวันนี้</Empty>
        ) : (
          <div className="flex h-48 items-end gap-[2px] border-b border-stone-200" role="img" aria-label="กราฟยอดขายรายชั่วโมง">
            {span.map((h) => (
              <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end" tabIndex={0}>
                <div
                  className="rounded-t-[4px] bg-brand-600 transition-colors group-hover:bg-brand-800 group-focus:bg-brand-800"
                  style={{ height: `${(h.salesSatang / maxH) * 100}%`, minHeight: h.salesSatang ? 2 : 0 }}
                />
                <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-stone-500 tabular">{h.hour}</span>
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow group-hover:block group-focus:block">
                  {String(h.hour).padStart(2, '0')}:00 · {baht(h.salesSatang)} · {h.orders} บิล
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="h-6" />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 font-semibold">เมนูขายดี</h2>
          {d.topProducts.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <ul className="space-y-2.5">
              {d.topProducts.map((p) => (
                <li key={p.name}>
                  <div className="flex justify-between text-sm">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 pl-2 text-stone-600 tabular">
                      {p.qty} · {baht(p.salesSatang)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-stone-100">
                    <div className="h-2 rounded-full bg-brand-600" style={{ width: `${(p.salesSatang / maxTop) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 font-semibold">แยกตามวิธีชำระ</h2>
          {d.byMethod.length === 0 ? (
            <Empty>—</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500">
                  <th className="pb-2 font-normal">วิธี</th>
                  <th className="pb-2 text-right font-normal">ครั้ง</th>
                  <th className="pb-2 text-right font-normal">ยอด</th>
                  <th className="pb-2 text-right font-normal">สัดส่วน</th>
                </tr>
              </thead>
              <tbody>
                {d.byMethod.map((m) => (
                  <tr key={m.method} className="border-t border-stone-100">
                    <td className="py-2">{METHOD_TH[m.method]}</td>
                    <td className="py-2 text-right tabular">{m.count}</td>
                    <td className="py-2 text-right tabular">{baht(m.amountSatang)}</td>
                    <td className="py-2 text-right tabular">{Math.round((m.amountSatang / methodTotal) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-stone-500">{label}</div>
      <div className={`mt-1 font-semibold tabular ${big ? 'text-2xl text-brand-700' : 'text-xl'}`}>{value}</div>
    </Card>
  );
}
