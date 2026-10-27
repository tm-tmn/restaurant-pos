import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { baht } from '../lib/money';
import { promptPayPayload } from '../lib/promptpay';

export function PromptPayQR({ promptpayId, amountSatang }: { promptpayId: string | null; amountSatang: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    setError(null);
    if (!promptpayId) {
      setError('ร้านยังไม่ได้ตั้งค่า PromptPay ID (ตั้งได้ที่ จัดการ → ตั้งค่าร้าน)');
      return;
    }
    try {
      const payload = promptPayPayload(promptpayId, amountSatang);
      QRCode.toDataURL(payload, { margin: 1, width: 280, errorCorrectionLevel: 'M' }).then(setSrc, () => setError('สร้าง QR ไม่สำเร็จ'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [promptpayId, amountSatang]);

  if (error) return <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{error}</div>;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="rounded-lg bg-[#113566] px-4 py-1.5 text-sm font-semibold tracking-wide text-white">Thai QR Payment · PromptPay</div>
      {src ? <img src={src} alt="QR PromptPay" className="h-64 w-64" /> : <div className="h-64 w-64 animate-pulse rounded bg-stone-100" />}
      <div className="text-2xl font-semibold tabular">{baht(amountSatang)}</div>
      <p className="text-center text-xs text-stone-500">
        ตรวจสอบยอดเงินเข้าในแอปธนาคารของร้านก่อนกดยืนยัน
        <br />
        (การยืนยันอัตโนมัติผ่าน Payment Gateway อยู่ใน Phase 3)
      </p>
    </div>
  );
}
