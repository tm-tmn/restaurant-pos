import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, QrCode, ShoppingBag } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, cn } from '../components/ui';
import { api, ApiError, NetworkError } from '../lib/api';
import { baht } from '../lib/money';
import { uuid } from '../lib/uuid';
import type { CustomerBill, CustomerPage, KitchenStatus } from '../types';

const STATUS_TH: Record<KitchenStatus, string> = { new: 'รับออเดอร์แล้ว', preparing: 'กำลังทำ', ready: 'พร้อมเสิร์ฟ', served: 'เสิร์ฟแล้ว' };
const STATUS_TONE: Record<KitchenStatus, 'stone' | 'amber' | 'green' | 'brand'> = { new: 'stone', preparing: 'amber', ready: 'brand', served: 'green' };

/** หน้าสั่งอาหารสำหรับลูกค้า (สแกน QR ที่โต๊ะ) — ไม่ต้องล็อกอิน */
export function CustomerOrderPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const key = ['customer', token];
  const page = useQuery({
    queryKey: key,
    queryFn: () => api<CustomerPage>(`/public/t/${token}`, { auth: false }),
    refetchInterval: 6_000,
    retry: (n, e) => !(e instanceof ApiError) && n < 2,
  });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [cat, setCat] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [submissionId, setSubmissionId] = useState(uuid);
  const [msg, setMsg] = useState<string | null>(null);

  const products = page.data?.menu.products ?? [];
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const count = lines.reduce((s, [, q]) => s + q, 0);
  const total = lines.reduce((s, [id, q]) => s + (byId.get(id)?.priceSatang ?? 0) * q, 0);

  const send = useMutation({
    mutationFn: () =>
      api<{ requireApproval: boolean; order: CustomerBill }>(`/public/t/${token}/order`, {
        auth: false,
        body: { submissionId, items: lines.map(([productId, qty]) => ({ productId, qty, ...(notes[productId]?.trim() ? { note: notes[productId].trim() } : {}) })) },
      }),
    onSuccess: (r) => {
      setCart({});
      setNotes({});
      setSheet(false);
      setSubmissionId(uuid()); // ใช้รหัสใหม่ต่อการสั่งครั้งถัดไป (ครั้งนี้สำเร็จแล้ว)
      setMsg(r.requireApproval ? 'ส่งออเดอร์แล้ว รอพนักงานยืนยันสักครู่' : 'ส่งออเดอร์เข้าครัวแล้ว');
      qc.invalidateQueries({ queryKey: key });
    },
    // เน็ตหลุด: คง submissionId เดิมไว้ กดส่งซ้ำได้โดยไม่เกิดรายการซ้ำ
    onError: (e) => setMsg(e instanceof NetworkError ? 'เชื่อมต่อไม่ได้ กดส่งอีกครั้งได้เลย (ไม่เกิดรายการซ้ำ)' : (e as Error).message),
  });

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);

  if (page.isLoading) return <Shell>กำลังโหลดเมนู…</Shell>;
  if (page.isError) {
    const e = page.error;
    return <Shell>{e instanceof ApiError ? e.message : 'เชื่อมต่อไม่ได้ กรุณาลองใหม่'}</Shell>;
  }
  const d = page.data!;
  const cats = d.menu.categories;
  const shown = products.filter((p) => cat === null || p.categoryId === cat);
  const set = (id: string, delta: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + delta)) }));
  const hasPending = d.order?.items.some((i) => i.status === 'pending');

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col bg-stone-50 pb-28">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white px-4 py-3">
        <div className="text-xs text-stone-500">{d.branch.name}</div>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">โต๊ะ {d.table.name}</h1>
          <span className="text-xs text-stone-500">สั่งอาหารผ่านมือถือ</span>
        </div>
        <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1">
          {[{ id: null as string | null, name: 'ทั้งหมด' }, ...cats].map((c) => (
            <button
              key={c.id ?? 'all'}
              onClick={() => setCat(c.id)}
              className={cn('shrink-0 rounded-full px-4 py-1.5 text-sm font-medium', cat === c.id ? 'bg-brand-700 text-white' : 'bg-stone-100 text-stone-700')}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      {msg && (
        <div role="status" className="mx-4 mt-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {msg}
        </div>
      )}

      <ul className="divide-y divide-stone-100 bg-white">
        {shown.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{p.name}</div>
              <div className="text-sm text-stone-500 tabular">{baht(p.priceSatang)}</div>
            </div>
            {cart[p.id] ? (
              <div className="flex items-center gap-2">
                <button onClick={() => set(p.id, -1)} className="grid h-9 w-9 place-items-center rounded-full border border-stone-300" aria-label={`ลด ${p.name}`}>
                  <Minus size={16} />
                </button>
                <span className="w-6 text-center font-semibold tabular">{cart[p.id]}</span>
                <button onClick={() => set(p.id, 1)} className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white" aria-label={`เพิ่ม ${p.name}`}>
                  <Plus size={16} />
                </button>
              </div>
            ) : (
              <button onClick={() => set(p.id, 1)} className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white" aria-label={`เพิ่ม ${p.name}`}>
                <Plus size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>

      {d.order && d.order.items.length > 0 && <BillSection bill={d.order} requireApproval={d.requireApproval} />}
      {/* PayQr อยู่นอกส่วนบิลโดยตั้งใจ: ชำระเสร็จบิลจะหายจากหน้า แต่ข้อความ "ชำระเรียบร้อย" ต้องยังอยู่ */}
      {d.canPay && <PayQr token={token} total={d.order?.totalSatang ?? 0} allowStart={!!d.order && !hasPending && d.order.items.some((i) => i.status === 'active')} />}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-stone-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button size="lg" className="w-full justify-between" onClick={() => setSheet(true)}>
            <span className="flex items-center gap-2">
              <ShoppingBag size={20} /> ดูตะกร้า ({count})
            </span>
            <span className="tabular">{baht(total)}</span>
          </Button>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setSheet(false)}>
          <div className="mx-auto max-h-[85vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-semibold">ตะกร้าของคุณ</h2>
            <ul className="space-y-3">
              {lines.map(([id, q]) => (
                <li key={id}>
                  <div className="flex items-center gap-3">
                    <span className="w-8 font-semibold tabular">{q}×</span>
                    <span className="flex-1">{byId.get(id)?.name}</span>
                    <span className="tabular">{baht((byId.get(id)?.priceSatang ?? 0) * q)}</span>
                  </div>
                  <input
                    value={notes[id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [id]: e.target.value }))}
                    maxLength={100}
                    placeholder="หมายเหตุ เช่น ไม่เผ็ด, ไม่ใส่ผัก"
                    className="mt-1 h-9 w-full rounded-lg border border-stone-200 px-3 text-sm outline-none focus:border-brand-600"
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-baseline justify-between border-t border-stone-200 pt-3">
              <span className="text-stone-600">รวม</span>
              <span className="text-2xl font-semibold tabular">{baht(total)}</span>
            </div>
            {d.requireApproval && <p className="mt-2 text-xs text-stone-500">พนักงานจะยืนยันออเดอร์ก่อนส่งเข้าครัว</p>}
            <Button size="lg" className="mt-3 w-full" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? 'กำลังส่ง…' : 'ยืนยันสั่งอาหาร'}
            </Button>
            {send.isError && <p className="mt-2 text-sm text-red-600">{msg}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function BillSection({ bill, requireApproval }: { bill: CustomerBill; requireApproval: boolean }) {
  return (
    <section className="mt-4 bg-white px-4 py-4">
      <h2 className="mb-2 font-semibold">รายการที่สั่งแล้ว</h2>
      <ul className="space-y-2">
        {bill.items.map((i, idx) => (
          <li key={idx} className={cn('flex items-start gap-3 text-sm', i.status === 'void' && 'text-stone-400')}>
            <span className="w-7 font-semibold tabular">{i.qty}×</span>
            <div className="min-w-0 flex-1">
              <div className={i.status === 'void' ? 'line-through' : ''}>{i.name}</div>
              {i.note && <div className="text-xs text-stone-500">{i.note}</div>}
            </div>
            <div className="text-right">
              <div className="tabular">{i.status === 'void' ? '' : baht(i.unitPriceSatang * i.qty)}</div>
              {i.status === 'pending' ? (
                <Badge tone="amber">{requireApproval ? 'รอพนักงานยืนยัน' : 'กำลังส่ง'}</Badge>
              ) : i.status === 'void' ? (
                <Badge tone="red">ร้านไม่รับรายการนี้</Badge>
              ) : (
                <Badge tone={STATUS_TONE[i.kitchenStatus]}>{STATUS_TH[i.kitchenStatus]}</Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-stone-200 pt-3">
        <span className="text-stone-600">ยอดรวม (ไม่รวมรายการรอยืนยัน)</span>
        <span className="text-xl font-semibold tabular">{baht(bill.totalSatang)}</span>
      </div>
      <p className="mt-2 text-xs text-stone-500">ชำระเงินได้ที่แคชเชียร์ หรือจ่ายผ่าน PromptPay</p>
    </section>
  );
}

function PayQr({ token, total, allowStart }: { token: string; total: number; allowStart: boolean }) {
  const [state, setState] = useState<{ id: string; img: string; amount: number; expiresAt: string } | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'paid' | 'expired'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setStatus('busy');
    setErr(null);
    try {
      const r = await api<{ id: string; qrPayload: string; amountSatang: number; expiresAt: string }>(`/public/t/${token}/pay`, { auth: false, body: {} });
      const img = await QRCode.toDataURL(r.qrPayload, { margin: 1, width: 280, errorCorrectionLevel: 'M' });
      setState({ id: r.id, img, amount: r.amountSatang, expiresAt: r.expiresAt });
      setStatus('idle');
    } catch (e) {
      setErr((e as Error).message);
      setStatus('idle');
    }
  }

  // โพลสถานะทุก 2 วินาทีจนกว่าจะจ่ายแล้ว/หมดอายุ
  useEffect(() => {
    if (!state || status === 'paid' || status === 'expired') return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ status: string }>(`/public/t/${token}/pay/${state.id}`, { auth: false });
        if (r.status === 'paid') {
          setStatus('paid');
        } else if (r.status === 'expired' || r.status === 'cancelled') {
          setStatus('expired');
        }
      } catch {
        /* ลองใหม่รอบถัดไป */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [state, status, token]);

  // ยอดบิลเปลี่ยน (สั่งเพิ่ม) → QR เดิมใช้ไม่ได้แล้ว
  useEffect(() => {
    // total = 0 คือบิลปิดไปแล้ว (อาจเพราะเพิ่งจ่าย) — ปล่อยให้โพลสถานะตัดสิน อย่าเพิ่งทิ้ง QR
    if (state && total > 0 && state.amount !== total && status !== 'paid') {
      setState(null);
      setStatus('idle');
    }
  }, [total, state, status]);

  if (status === 'paid')
    return (
      <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-green-50 p-4 text-green-800" role="status">
        <CheckCircle2 /> ชำระเงินเรียบร้อย ขอบคุณที่ใช้บริการ
      </div>
    );
  if (!state) {
    if (!allowStart || total <= 0) return null;
    return (
      <div className="mt-4 bg-white px-4 pb-4">
        <Button variant="outline" className="w-full" disabled={status === 'busy'} onClick={start}>
          <QrCode size={18} /> จ่ายด้วย PromptPay {baht(total)}
        </Button>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>
    );
  }
  return (
    <div className="mx-4 mt-4 flex flex-col items-center gap-2 rounded-xl border border-stone-200 bg-white p-4">
      <div className="rounded-lg bg-[#113566] px-4 py-1.5 text-sm font-semibold text-white">Thai QR Payment · PromptPay</div>
      <img src={state.img} alt="QR PromptPay" className="h-64 w-64" />
      <div className="text-2xl font-semibold tabular">{baht(state.amount)}</div>
      {status === 'expired' ? (
        <>
          <p className="text-sm text-amber-700">QR หมดอายุแล้ว</p>
          <Button variant="outline" onClick={start}>สร้าง QR ใหม่</Button>
        </>
      ) : (
        <p className="text-center text-xs text-stone-500">สแกนด้วยแอปธนาคาร ระบบจะแจ้งอัตโนมัติเมื่อได้รับเงิน — ไม่ต้องปิดหน้านี้</p>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-full place-items-center bg-stone-50 p-8 text-center text-stone-600">{children}</div>;
}
