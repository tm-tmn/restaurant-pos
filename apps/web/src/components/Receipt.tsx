import { baht } from '../lib/money';
import type { PaymentMethod } from '../types';

export interface ReceiptData {
  orderNo: string | null;
  branchName: string;
  at: Date;
  cashier: string;
  lines: { name: string; qty: number; unitPriceSatang: number }[];
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  payments: { method: PaymentMethod; amountSatang: number; receivedSatang?: number; changeSatang?: number }[];
  pendingSync?: boolean;
}

const METHOD_TH: Record<PaymentMethod, string> = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร' };

/** ใบเสร็จอย่างย่อสำหรับเครื่องพิมพ์ความร้อน 80mm (แสดงเฉพาะตอนสั่งพิมพ์) */
export function Receipt({ data }: { data: ReceiptData | null }) {
  if (!data) return null;
  const row = 'flex justify-between gap-2';
  return (
    <div className="print-only font-sans">
      <div className="text-center text-base font-semibold">{data.branchName}</div>
      <div className="text-center">ใบเสร็จรับเงินอย่างย่อ</div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        <div className={row}>
          <span>เลขที่</span>
          <span>{data.orderNo ?? 'รอซิงค์'}</span>
        </div>
        <div className={row}>
          <span>วันที่</span>
          <span>{data.at.toLocaleString('th-TH')}</span>
        </div>
        <div className={row}>
          <span>พนักงาน</span>
          <span>{data.cashier}</span>
        </div>
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {data.lines.map((l, i) => (
          <div key={i} className={row}>
            <span>
              {l.qty} × {l.name}
            </span>
            <span>{baht(l.qty * l.unitPriceSatang)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        <div className={row}>
          <span>รวม</span>
          <span>{baht(data.subtotalSatang)}</span>
        </div>
        {data.discountSatang > 0 && (
          <div className={row}>
            <span>ส่วนลด</span>
            <span>-{baht(data.discountSatang)}</span>
          </div>
        )}
        <div className={`${row} text-base font-semibold`}>
          <span>สุทธิ</span>
          <span>{baht(data.totalSatang)}</span>
        </div>
        {data.payments.map((p, i) => (
          <div key={i}>
            <div className={row}>
              <span>{METHOD_TH[p.method]}</span>
              <span>{baht(p.receivedSatang ?? p.amountSatang)}</span>
            </div>
            {!!p.changeSatang && (
              <div className={row}>
                <span>เงินทอน</span>
                <span>{baht(p.changeSatang)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 text-center">ขอบคุณที่ใช้บริการ</div>
    </div>
  );
}
