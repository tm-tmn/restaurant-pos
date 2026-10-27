import { CheckCircle2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { baht } from '../lib/money';
import type { PaymentIntent } from '../types';
import { Button } from './ui';

/**
 * QR PromptPay แบบยืนยันอัตโนมัติ: เซิร์ฟเวอร์ตรึงยอดตามบิล แล้วรอผู้ให้บริการแจ้งเงินเข้า
 * (ยอด/ส่วนลดเปลี่ยน → ขอ QR ใหม่ให้อัตโนมัติ; QR ที่ปิดหน้าไปแล้วยังจ่ายสำเร็จได้จนกว่าจะหมดอายุ)
 */
export function AutoPromptPay({ orderId, discountSatang, onPaid }: { orderId: string; discountSatang: number | null; onPaid: () => void }) {
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'waiting' | 'paid' | 'expired' | 'review'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // สร้าง QR (รอ 400ms หลังพิมพ์ส่วนลดเสร็จ ไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    if (discountSatang === null) return;
    let live = true;
    setState('loading');
    setError(null);
    const t = setTimeout(async () => {
      try {
        const i = await api<PaymentIntent>(`/orders/${orderId}/payment-intents`, { body: { discountSatang } });
        const dataUrl = await QRCode.toDataURL(i.qrPayload, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
        if (!live) return;
        setIntent(i);
        setImg(dataUrl);
        setState('waiting');
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [orderId, discountSatang, nonce]);

  // โพลสถานะทุก 2 วินาที
  useEffect(() => {
    if (!intent || state !== 'waiting') return;
    const t = setInterval(async () => {
      try {
        const r = await api<PaymentIntent>(`/payment-intents/${intent.id}`);
        if (r.status === 'paid') {
          setState('paid');
          onPaid();
        } else if (r.status === 'review') setState('review');
        else if (r.status === 'expired' || r.status === 'cancelled') setState('expired');
      } catch {
        /* เน็ตสะดุด ลองรอบหน้า */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [intent, state, onPaid]);

  if (error) return <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{error}</div>;
  if (state === 'paid')
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl bg-green-50 p-6 text-green-800" role="status">
        <CheckCircle2 size={48} />
        <div className="text-lg font-semibold">ได้รับเงินแล้ว</div>
        <div className="text-sm">ระบบปิดบิลให้อัตโนมัติ</div>
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg bg-[#113566] px-4 py-1.5 text-sm font-semibold tracking-wide text-white">Thai QR Payment · PromptPay</div>
      {img && state !== 'loading' ? <img src={img} alt="QR PromptPay" className={`h-64 w-64 ${state === 'expired' || state === 'review' ? 'opacity-30' : ''}`} /> : <div className="h-64 w-64 animate-pulse rounded bg-stone-100" />}
      {intent && <div className="text-2xl font-semibold tabular">{baht(intent.amountSatang)}</div>}
      {state === 'waiting' && (
        <p className="flex items-center gap-2 text-sm text-stone-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> รอเงินเข้า — ระบบจะปิดบิลให้เองเมื่อได้รับยอดตรงกัน
        </p>
      )}
      {state === 'expired' && (
        <div className="text-center">
          <p className="text-sm text-amber-700">QR หมดอายุหรือถูกยกเลิก</p>
          <Button variant="outline" size="sm" className="mt-1" onClick={() => setNonce((n) => n + 1)}>
            สร้าง QR ใหม่
          </Button>
        </div>
      )}
      {state === 'review' && <p className="text-center text-sm text-red-700">ได้รับเงินแต่ยอดไม่ตรงกับบิล — ห้ามปิดบิลอัตโนมัติ ให้ผู้จัดการตรวจสอบ (รายงาน → ประวัติที่ต้องตรวจสอบ)</p>}
    </div>
  );
}
