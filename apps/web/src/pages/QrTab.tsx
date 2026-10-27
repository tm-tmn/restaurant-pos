import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Button, Card, Input, Label } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../store/toast';
import type { Branch } from '../types';

const BASE_KEY = 'pos-qr-base-url';
const getBase = () => {
  try {
    return localStorage.getItem(BASE_KEY) || location.origin;
  } catch {
    return location.origin;
  }
};

interface TableQr {
  id: string;
  name: string;
  qrToken: string;
}

/** ตั้งค่าการสั่งอาหารผ่าน QR + พิมพ์ QR ประจำโต๊ะ */
export function QrTab() {
  const { branch, setBranch } = useAuth();
  const toast = useToast((s) => s.show);
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: ['tables-qr'], queryFn: () => api<TableQr[]>('/tables/qr') });
  const [base, setBase] = useState(getBase);
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);

  const urlOf = (t: TableQr) => `${base.replace(/\/+$/, '')}/t/${t.qrToken}`;

  useEffect(() => {
    let live = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const t of tables.data ?? []) out[t.id] = await QRCode.toDataURL(urlOf(t), { margin: 1, width: 300, errorCorrectionLevel: 'M' });
      if (live) setImgs(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.data, base]);

  async function patch(body: Partial<Pick<Branch, 'qrOrdering' | 'qrRequireApproval'>>) {
    setBusy(true);
    try {
      setBranch(await api<Branch>('/branches/me', { method: 'PATCH', body }));
      toast('บันทึกแล้ว');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function print() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  const toggle = (label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-teal-700" checked={checked} disabled={busy} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-stone-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        {toggle('เปิดให้ลูกค้าสั่งอาหารผ่าน QR ที่โต๊ะ', 'ปิดชั่วคราวได้ทันทีถ้าไม่พร้อมรับออเดอร์ — QR จะแจ้งลูกค้าให้สั่งกับพนักงาน', branch?.qrOrdering !== false, (v) => patch({ qrOrdering: v }))}
        {toggle(
          'พนักงานต้องยืนยันก่อนส่งเข้าครัว (แนะนำ)',
          'กันการสั่งแกล้งหรือสั่งผิดโต๊ะ — รายการจะยังไม่นับยอดและไม่ขึ้นจอครัวจนกว่าพนักงานกดยืนยัน',
          branch?.qrRequireApproval !== false,
          (v) => patch({ qrRequireApproval: v }),
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <Label>ที่อยู่เว็บที่ลูกค้าเข้าถึงได้จากมือถือ</Label>
          <Input
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              try {
                localStorage.setItem(BASE_KEY, e.target.value);
              } catch {
                /* ไม่เป็นไร */
              }
            }}
          />
          <p className="mt-1 text-xs text-stone-500">
            ใช้สร้างลิงก์ใน QR — ถ้าเครื่อง POS เปิดผ่าน IP ในร้าน (เช่น 192.168.x.x) ลูกค้าจะเข้าไม่ได้ ให้ใส่ที่อยู่เว็บจริงของร้านที่เข้าได้จากอินเทอร์เน็ต
          </p>
        </div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">QR ประจำโต๊ะ</h3>
          <Button variant="outline" size="sm" className="ml-auto" onClick={print} disabled={!tables.data?.length}>
            <Printer size={16} /> พิมพ์ทั้งหมด (A4)
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {tables.data?.map((t) => (
            <li key={t.id} className="flex flex-col items-center gap-1 rounded-xl border border-stone-200 p-3">
              <div className="font-semibold">โต๊ะ {t.name}</div>
              {imgs[t.id] ? <img src={imgs[t.id]} alt={`QR โต๊ะ ${t.name}`} className="h-32 w-32" /> : <div className="h-32 w-32 animate-pulse rounded bg-stone-100" />}
              <button
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-red-600"
                onClick={async () => {
                  if (!confirm(`สร้าง QR ใหม่ให้โต๊ะ ${t.name}? QR ใบเดิมจะใช้ไม่ได้ทันที (ต้องพิมพ์ใหม่)`)) return;
                  try {
                    await api(`/tables/${t.id}/rotate-qr`, { body: {} });
                    await qc.invalidateQueries({ queryKey: ['tables-qr'] });
                    toast('สร้าง QR ใหม่แล้ว');
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                <RefreshCw size={12} /> สร้าง QR ใหม่
              </button>
            </li>
          ))}
        </ul>
        {tables.data?.length === 0 && <p className="text-sm text-stone-500">ยังไม่มีโต๊ะ — เพิ่มที่แท็บ "โต๊ะ"</p>}
      </Card>

      {printing && (
        <div className="print-only qr-sheet">
          <div className="grid grid-cols-3 gap-4">
            {tables.data?.map((t) => (
              <div key={t.id} className="break-inside-avoid rounded-lg border border-black p-3 text-center">
                <div className="text-lg font-semibold">โต๊ะ {t.name}</div>
                {imgs[t.id] && <img src={imgs[t.id]} alt="" className="mx-auto h-40 w-40" />}
                <div>สแกนเพื่อสั่งอาหาร</div>
                <div className="text-xs">{branch?.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
