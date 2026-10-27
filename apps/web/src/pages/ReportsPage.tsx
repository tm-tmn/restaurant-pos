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
        <>
          <Body d={r.data!} />
          <AuditList date={date} />
        </>
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
        <Stat label="ยกเลิกบิล / รายการ" value={`${d.voidedOrders} / ${d.voidedItems} ครั้ง`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="ต้นทุนขาย (วัตถุดิบตามสูตร)" value={baht(d.cogsSatang)} />
        <Stat
          label="กำไรขั้นต้น"
          value={`${baht(d.grossProfitSatang)}${d.salesSatang > 0 ? ` · ${Math.round((d.grossProfitSatang / d.salesSatang) * 100)}%` : ''}`}
        />
        <Stat label="มูลค่าของเสีย" value={baht(d.wasteSatang)} />
        <Stat label="ส่วนลดรวม" value={baht(d.discountSatang)} />
      </div>
      <p className="-mt-2 text-xs text-stone-500">ต้นทุนขายนับเฉพาะเมนูที่มีสูตร — เมนูที่ยังไม่มีสูตรคิดต้นทุนเป็น 0</p>

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

interface AuditRow {
  id: string;
  action: string;
  label: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
}

/** สรุปรายละเอียดเหตุการณ์ให้อ่านง่าย */
function describe(a: AuditRow): string {
  const d = a.detail ?? {};
  const parts: string[] = [];
  if (d.orderNo) parts.push(String(d.orderNo));
  if (d.name) parts.push(`${d.qty ?? ''}× ${d.name}`);
  if (typeof d.totalSatang === 'number') parts.push(baht(d.totalSatang));
  if (typeof d.discountSatang === 'number') parts.push(`ส่วนลด ${baht(d.discountSatang)}`);
  if (typeof d.valueSatang === 'number') parts.push(`มูลค่า ${baht(d.valueSatang)}`);
  if (Array.isArray(d.items) && a.action === 'sync.price_mismatch') {
    parts.push(
      (d.items as { name: string; soldSatang: number; currentSatang: number }[])
        .map((i) => `${i.name} ขาย ${baht(i.soldSatang)} (ปัจจุบัน ${baht(i.currentSatang)})`)
        .join(', '),
    );
  }
  if (d.reason) parts.push(`เหตุผล: ${d.reason}`);
  return parts.join(' · ');
}

function AuditList({ date }: { date: string }) {
  const q = useQuery({ queryKey: ['audit', date], queryFn: () => api<AuditRow[]>(`/reports/audit?date=${date}`) });
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-semibold">ประวัติที่ต้องตรวจสอบ</h2>
      <p className="mb-3 text-sm text-stone-500">ยกเลิกบิล/รายการ, ส่วนลด, ราคาขายออฟไลน์ไม่ตรง, ของเสีย, แก้สูตร — พร้อมผู้ดำเนินการ</p>
      {q.isLoading ? (
        <Empty>กำลังโหลด…</Empty>
      ) : !q.data?.length ? (
        <Empty>ไม่มีรายการ</Empty>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {q.data.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2">
              <span className="w-12 shrink-0 text-stone-500 tabular">
                {new Date(a.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="font-medium">{a.label}</span>
              <span className="min-w-0 flex-1 text-stone-600">{describe(a)}</span>
              <span className="text-stone-500">{a.userName ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
