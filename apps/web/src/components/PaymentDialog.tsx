import { Banknote, CreditCard, QrCode } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { baht, parseBahtToSatang } from '../lib/money';
import { isManager, useAuth } from '../store/auth';
import type { PaymentInput, PaymentMethod } from '../types';
import { AutoPromptPay } from './AutoPromptPay';
import { PromptPayQR } from './PromptPayQR';
import { Button, cn, Input, Label, Modal } from './ui';

export interface PaymentResult {
  discountSatang: number;
  payments: PaymentInput[];
}

const METHODS: { id: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { id: 'cash', label: 'เงินสด', icon: Banknote },
  { id: 'promptpay', label: 'PromptPay', icon: QrCode },
  { id: 'card', label: 'บัตร', icon: CreditCard },
];

/** ปุ่มเงินสดด่วน: ยอดพอดี + ธนบัตรที่มากกว่ายอด */
function quickCash(total: number) {
  const notes = [2000, 5000, 10000, 50000, 100000]; // 20, 50, 100, 500, 1000 บาท (สตางค์)
  const set = new Set<number>([total]);
  for (const n of notes) if (n > total) set.add(Math.ceil(total / n) * n);
  return [...set].sort((a, b) => a - b).slice(0, 5);
}

export function PaymentDialog({
  open,
  onClose,
  subtotalSatang,
  onConfirm,
  orderId,
  onPaidAuto,
}: {
  open: boolean;
  onClose: () => void;
  subtotalSatang: number;
  onConfirm: (r: PaymentResult) => Promise<void>;
  /** บิลที่อยู่ในระบบแล้ว → จ่าย PromptPay แบบยืนยันอัตโนมัติได้ (ถ้าร้านเปิดใช้) */
  orderId?: string;
  /** เรียกเมื่อระบบแจ้งว่าเงินเข้าและปิดบิลให้แล้ว */
  onPaidAuto?: () => void;
}) {
  const { user, branch } = useAuth();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [received, setReceived] = useState('');
  const [discount, setDiscount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = useQuery({ queryKey: ['payments-config'], queryFn: () => api<{ autoConfirm: boolean }>('/payments/config'), staleTime: 5 * 60_000, enabled: open && !!orderId });
  const auto = !!orderId && cfg.data?.autoConfirm === true;

  useEffect(() => {
    if (open) {
      setMethod('cash');
      setReceived('');
      setDiscount('');
      setReference('');
      setError(null);
    }
  }, [open]);

  const discountSatang = discount ? (parseBahtToSatang(discount) ?? -1) : 0;
  const total = subtotalSatang - Math.max(0, discountSatang);
  const receivedSatang = received ? parseBahtToSatang(received) : total;
  const change = receivedSatang !== null ? receivedSatang - total : -1;
  const quick = useMemo(() => quickCash(total), [total]);

  const invalid =
    discountSatang < 0 || discountSatang >= subtotalSatang
      ? 'ส่วนลดไม่ถูกต้อง (ต้องน้อยกว่ายอดรวม)'
      : method === 'cash' && (receivedSatang === null || change < 0)
        ? 'เงินที่รับไม่พอ'
        : null;

  async function confirm() {
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({
        discountSatang: Math.max(0, discountSatang),
        payments: [
          {
            method,
            amountSatang: total,
            ...(method === 'cash' ? { receivedSatang: receivedSatang ?? total } : {}),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          },
        ],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="ชำระเงิน" wide>
      <div className="grid gap-5 sm:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-xl bg-stone-50 p-4">
            <div className="flex justify-between text-sm text-stone-600">
              <span>ยอดรวม</span>
              <span className="tabular">{baht(subtotalSatang)}</span>
            </div>
            {discountSatang > 0 && (
              <div className="flex justify-between text-sm text-red-600">
                <span>ส่วนลด</span>
                <span className="tabular">-{baht(discountSatang)}</span>
              </div>
            )}
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-medium">ยอดชำระ</span>
              <span className="text-3xl font-semibold tabular text-brand-700">{baht(Math.max(0, total))}</span>
            </div>
          </div>

          {isManager(user?.role) && (
            <div>
              <Label>ส่วนลด (บาท)</Label>
              <Input inputMode="decimal" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border-2 py-3 text-sm font-medium',
                  method === m.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-stone-200 hover:bg-stone-50',
                )}
              >
                <m.icon size={22} />
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {method === 'cash' && (
            <>
              <div>
                <Label>รับเงินมา (บาท)</Label>
                <Input
                  autoFocus
                  inputMode="decimal"
                  className="h-14 text-2xl tabular"
                  placeholder={(total / 100).toString()}
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirm()}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {quick.map((q) => (
                  <Button key={q} variant="outline" onClick={() => setReceived((q / 100).toString())} className="tabular">
                    {q === total ? 'พอดี' : baht(q)}
                  </Button>
                ))}
              </div>
              <div className="flex items-baseline justify-between rounded-xl bg-amber-50 p-4">
                <span className="font-medium text-amber-900">เงินทอน</span>
                <span className="text-3xl font-semibold tabular text-amber-900">{change >= 0 ? baht(change) : '—'}</span>
              </div>
            </>
          )}
          {method === 'promptpay' && auto && (
            <AutoPromptPay
              orderId={orderId!}
              discountSatang={invalid ? null : Math.max(0, discountSatang)}
              onPaid={() => onPaidAuto?.()}
            />
          )}
          {method === 'promptpay' && !auto && <PromptPayQR promptpayId={branch?.promptpayId ?? null} amountSatang={Math.max(1, total)} />}
          {method === 'card' && (
            <div>
              <Label>เลขอ้างอิงสลิป EDC (ไม่บังคับ)</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              <p className="mt-2 text-sm text-stone-500">รูดบัตรที่เครื่อง EDC ให้สำเร็จก่อน แล้วจึงกดยืนยัน</p>
            </div>
          )}
        </div>
      </div>

      {(error || invalid) && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error ?? invalid}</p>}

      <Button size="lg" variant={method === 'promptpay' && auto ? 'outline' : 'primary'} className="mt-5 w-full" disabled={!!invalid || busy} onClick={confirm}>
        {busy ? 'กำลังบันทึก…' : method === 'promptpay' ? (auto ? 'ยืนยันเอง (กรณีระบบไม่แจ้งเงินเข้า)' : 'ได้รับเงินแล้ว — ยืนยันการชำระ') : 'ยืนยันการชำระ'}
      </Button>
    </Modal>
  );
}
