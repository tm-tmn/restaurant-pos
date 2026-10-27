import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Empty, cn } from '../components/ui';
import { api } from '../lib/api';
import { baht } from '../lib/money';
import type { TableInfo } from '../types';

export function TablesPage() {
  const nav = useNavigate();
  const tables = useQuery({ queryKey: ['tables'], queryFn: () => api<TableInfo[]>('/tables'), refetchInterval: 15_000 });

  if (tables.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (tables.isError) return <Empty>โหลดข้อมูลโต๊ะไม่ได้ — ระบบโต๊ะต้องออนไลน์ ({(tables.error as Error).message})</Empty>;

  const busy = tables.data!.filter((t) => t.openOrder).length;
  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">โต๊ะ</h1>
        <span className="text-sm text-stone-500">
          ไม่ว่าง {busy} / {tables.data!.length}
        </span>
      </div>
      {tables.data!.length === 0 ? (
        <Empty>ยังไม่มีโต๊ะ — เพิ่มได้ที่ จัดการ → โต๊ะ</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {tables.data!.map((t) => (
            <button
              key={t.id}
              onClick={() => nav(t.openOrder ? `/orders/${t.openOrder.id}` : `/?table=${t.id}`)}
              className={cn(
                'flex aspect-[4/3] flex-col justify-between rounded-2xl border-2 p-4 text-left transition active:scale-[0.98]',
                t.openOrder ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-200 bg-white hover:border-stone-300',
              )}
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl font-semibold">{t.name}</span>
                <span className={cn('flex items-center gap-1 text-xs', t.openOrder ? 'text-brand-100' : 'text-stone-500')}>
                  <Users size={14} />
                  {t.seats}
                </span>
              </div>
              {t.openOrder ? (
                <div>
                  <div className="text-xs text-brand-100">{t.openOrder.orderNo}</div>
                  <div className="text-lg font-semibold tabular">{baht(t.openOrder.totalSatang)}</div>
                </div>
              ) : (
                <span className="text-sm text-stone-500">ว่าง · แตะเพื่อเปิดบิล</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
