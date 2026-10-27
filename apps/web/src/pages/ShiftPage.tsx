import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, Empty, Input, Label } from '../components/ui';
import { api } from '../lib/api';
import { baht, parseBahtToSatang } from '../lib/money';
import { flushQueue, useSync } from '../lib/offline';
import { useToast } from '../store/toast';
import type { Shift } from '../types';

interface ClosedShift extends Shift {
  closingCashSatang: number;
  expectedCashSatang: number;
  closedAt: string;
}

export function ShiftPage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const pending = useSync((s) => s.pending);
  const shift = useQuery({ queryKey: ['shift'], queryFn: () => api<Shift | null>('/shifts/current') });
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<ClosedShift | null>(null);
  const satang = parseBahtToSatang(amount);

  async function run(path: string, body: object) {
    setBusy(true);
    try {
      const r = await api<Shift | ClosedShift>(path, { body });
      setAmount('');
      qc.invalidateQueries({ queryKey: ['shift'] });
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (shift.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (shift.isError) return <Empty>เปิด/ปิดกะต้องออนไลน์ ({(shift.error as Error).message})</Empty>;
  const s = shift.data;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <h1 className="text-xl font-semibold">กะการขาย</h1>

      {closed && (
        <Card className="p-4">
          <div className="mb-2 font-semibold">สรุปการปิดกะล่าสุด</div>
          <Row label="เงินสดที่ควรมี" value={baht(closed.expectedCashSatang)} />
          <Row label="เงินสดที่นับได้" value={baht(closed.closingCashSatang)} />
          <Row
            label="ส่วนต่าง"
            value={baht(closed.closingCashSatang - closed.expectedCashSatang)}
            tone={closed.closingCashSatang === closed.expectedCashSatang ? 'text-green-700' : 'text-red-600'}
          />
        </Card>
      )}

      <Card className="p-4">
        {s ? (
          <>
            <p className="mb-1 text-stone-600">กะเปิดอยู่ตั้งแต่ {new Date(s.openedAt).toLocaleString('th-TH')}</p>
            <p className="mb-4 text-stone-600">เงินทอนตั้งต้น {baht(s.openingCashSatang)}</p>
            {pending > 0 && (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                มี {pending} บิลที่ยังไม่ได้ส่งขึ้นระบบ — ควรส่งให้ครบก่อนปิดกะเพื่อให้ยอดเงินสดถูกต้อง{' '}
                <button className="font-medium underline" onClick={() => void flushQueue()}>
                  ส่งตอนนี้
                </button>
              </p>
            )}
            <Label>เงินสดที่นับได้ในลิ้นชัก (บาท)</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button
              variant="danger"
              className="mt-4 w-full"
              disabled={satang === null || busy}
              onClick={async () => {
                const r = await run('/shifts/close', { closingCashSatang: satang });
                if (r) setClosed(r as ClosedShift);
              }}
            >
              ปิดกะ
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-stone-600">ยังไม่ได้เปิดกะ — ต้องเปิดกะก่อนรับชำระเงิน</p>
            <Label>เงินทอนตั้งต้นในลิ้นชัก (บาท)</Label>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="เช่น 1000" />
            <Button
              className="mt-4 w-full"
              disabled={satang === null || busy}
              onClick={async () => {
                if (await run('/shifts/open', { openingCashSatang: satang })) {
                  setClosed(null);
                  toast('เปิดกะแล้ว');
                }
              }}
            >
              เปิดกะ
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-stone-600">{label}</span>
      <span className={`font-semibold tabular ${tone ?? ''}`}>{value}</span>
    </div>
  );
}
