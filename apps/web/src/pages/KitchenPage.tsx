import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChefHat, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, cn, Empty } from '../components/ui';
import { useBeep } from '../hooks/useBeep';
import { api } from '../lib/api';
import { useToast } from '../store/toast';
import type { KitchenStatus, KitchenTicket } from '../types';

const NEXT: Record<KitchenStatus, KitchenStatus> = { new: 'preparing', preparing: 'ready', ready: 'served', served: 'served' };
const LABEL: Record<KitchenStatus, string> = { new: 'ใหม่', preparing: 'กำลังทำ', ready: 'พร้อมเสิร์ฟ', served: 'เสิร์ฟแล้ว' };
const BTN: Record<KitchenStatus, string> = { new: 'เริ่มทำ', preparing: 'ทำเสร็จ', ready: 'เสิร์ฟแล้ว', served: '' };
const TONE: Record<KitchenStatus, string> = {
  new: 'border-stone-300 bg-white',
  preparing: 'border-amber-400 bg-amber-50',
  ready: 'border-green-500 bg-green-50',
  served: 'border-stone-200 bg-stone-50',
};

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** จอครัว (KDS): ใบสั่งเรียงตามเวลา แตะที่รายการเพื่อเลื่อนสถานะ */
export function KitchenPage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const beep = useBeep();
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(Date.now());
  const board = useQuery({ queryKey: ['kitchen'], queryFn: () => api<KitchenTicket[]>('/kitchen'), refetchInterval: 4_000 });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  // เสียงเตือนเมื่อมีรายการใหม่เข้ามา
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!board.data) return;
    const ids = new Set(board.data.flatMap((t) => t.items.filter((i) => i.status === 'new').map((i) => i.id)));
    if (seen.current && sound && [...ids].some((id) => !seen.current!.has(id))) beep();
    seen.current = ids;
  }, [board.data, sound, beep]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['kitchen'] });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  const setItem = (id: string, status: KitchenStatus) => run(() => api(`/kitchen/items/${id}`, { method: 'PATCH', body: { status } }));
  const setOrder = (orderId: string, status: KitchenStatus) => run(() => api(`/kitchen/orders/${orderId}/status`, { body: { status } }));

  if (board.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (board.isError) return <Empty>โหลดจอครัวไม่ได้ — ต้องออนไลน์ ({(board.error as Error).message})</Empty>;
  const tickets = board.data!;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <ChefHat className="text-stone-500" />
        <h1 className="text-xl font-semibold">ครัว</h1>
        <span className="text-sm text-stone-500">{tickets.length} ใบสั่ง</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
          {sound ? <Bell size={16} /> : <BellOff size={16} />} {sound ? 'เสียงเปิด' : 'เสียงปิด'}
        </Button>
      </div>
      {tickets.length === 0 ? (
        <Empty>ไม่มีรายการค้างในครัว</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {tickets.map((t) => {
            const mins = minutesSince(t.sentAt, now);
            const allReady = t.items.every((i) => i.status === 'ready');
            return (
              <section key={t.orderId} className="flex flex-col rounded-2xl border-2 border-stone-300 bg-white" aria-label={`ใบสั่ง ${t.tableName ?? t.orderNo}`}>
                <header className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
                  <span className="text-xl font-semibold">{t.type === 'dine_in' ? `โต๊ะ ${t.tableName ?? ''}` : 'กลับบ้าน'}</span>
                  <span className="text-xs text-stone-500">{t.orderNo.split('-').pop()}</span>
                  <span className={cn('ml-auto text-sm font-medium tabular', mins >= 20 ? 'text-red-600' : mins >= 10 ? 'text-amber-600' : 'text-stone-500')}>{mins} นาที</span>
                </header>
                <ul className="flex-1 space-y-1.5 p-2">
                  {t.items.map((i) => (
                    <li key={i.id}>
                      <button
                        onClick={() => setItem(i.id, NEXT[i.status])}
                        className={cn('flex w-full items-start gap-2 rounded-xl border-2 px-3 py-2 text-left active:scale-[0.99]', TONE[i.status])}
                      >
                        <span className="w-8 text-xl font-semibold tabular">{i.qty}×</span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{i.name}</span>
                          {i.note && <span className="block text-sm font-medium text-red-600">⚠ {i.note}</span>}
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
                            <Badge tone={i.status === 'ready' ? 'green' : i.status === 'preparing' ? 'amber' : 'stone'}>{LABEL[i.status]}</Badge>
                            {i.source === 'customer' && (
                              <span className="inline-flex items-center gap-0.5">
                                <User size={12} /> ลูกค้าสั่งเอง
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="self-center text-sm font-medium text-brand-700">{BTN[i.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <footer className="flex gap-2 border-t border-stone-200 p-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setOrder(t.orderId, 'ready')} disabled={allReady}>
                    พร้อมทั้งใบ
                  </Button>
                  <Button size="sm" className="flex-1" onClick={() => setOrder(t.orderId, 'served')}>
                    เสิร์ฟครบ
                  </Button>
                </footer>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
