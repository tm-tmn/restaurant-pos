import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, ScanBarcode, Search, ShoppingBag, Trash2, Utensils } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PaymentDialog, type PaymentResult } from '../components/PaymentDialog';
import { Receipt, type ReceiptData } from '../components/Receipt';
import { Button, cn, Empty, Input, Modal } from '../components/ui';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useMenu } from '../hooks/useMenu';
import { api } from '../lib/api';
import { baht } from '../lib/money';
import { enqueueOrder, flushQueue } from '../lib/offline';
import { uuid } from '../lib/uuid';
import { useAuth } from '../store/auth';
import { cartSubtotal, useCart, type CartLine } from '../store/cart';
import { useToast } from '../store/toast';
import type { Order, Product, Shift, SyncOrderPayload, TableInfo } from '../types';

export function PosPage() {
  const [params] = useSearchParams();
  const targetOrderId = params.get('order'); // เพิ่มรายการเข้าบิลโต๊ะที่เปิดอยู่
  const targetTableId = params.get('table'); // เปิดบิลใหม่ให้โต๊ะ
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const { user, branch } = useAuth();

  const menu = useMenu();
  const { lines, add, setQty, clear } = useCart();
  const [cat, setCat] = useState<string | 'all'>('all');
  const [q, setQ] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(ReceiptData & { changeSatang: number }) | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const shift = useQuery({ queryKey: ['shift'], queryFn: () => api<Shift | null>('/shifts/current'), retry: false });
  const tables = useQuery({ queryKey: ['tables'], queryFn: () => api<TableInfo[]>('/tables'), enabled: !!(targetOrderId || targetTableId) });
  const targetTable = tables.data?.find((t) => t.id === targetTableId || t.openOrder?.id === targetOrderId);

  const products = menu.data?.products ?? [];
  const byCode = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) {
      if (p.barcode) m.set(p.barcode, p);
      if (p.sku) m.set(p.sku.toLowerCase(), p);
    }
    return m;
  }, [products]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (cat === 'all' || p.categoryId === cat) &&
        (!s || p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s) || p.barcode?.includes(s)),
    );
  }, [products, cat, q]);

  function scan(code: string) {
    const p = byCode.get(code) ?? byCode.get(code.toLowerCase());
    if (p) {
      add(p);
      toast(`เพิ่ม ${p.name}`);
    } else toast(`ไม่พบสินค้าบาร์โค้ด ${code}`, 'error');
  }
  useBarcodeScanner(scan, !payOpen);

  const subtotal = cartSubtotal(lines);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const noShift = shift.isSuccess && shift.data === null;

  // ---------- โหมดโต๊ะ: ส่งรายการเข้าบิล (ต้องออนไลน์) ----------
  async function sendToTable() {
    setBusy(true);
    try {
      const items = lines.map((l) => ({ productId: l.productId, qty: l.qty }));
      const order = targetOrderId
        ? await api<Order>(`/orders/${targetOrderId}/items`, { body: { items } })
        : await api<Order>('/orders', { body: { clientId: uuid(), type: 'dine_in', tableId: targetTableId, items } });
      clear();
      qc.invalidateQueries({ queryKey: ['tables'] });
      toast('ส่งรายการเข้าบิลแล้ว');
      nav(`/orders/${order.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------- ขายหน้าร้าน: บันทึกลงเครื่องก่อนเสมอ แล้วค่อยซิงค์ ----------
  async function payTakeaway(r: PaymentResult) {
    const snapshot: CartLine[] = lines.map((l) => ({ ...l }));
    const payload: SyncOrderPayload = {
      clientId: uuid(),
      type: 'takeaway',
      occurredAt: new Date().toISOString(),
      discountSatang: r.discountSatang || undefined,
      items: snapshot.map((l) => ({ productId: l.productId, name: l.name, unitPriceSatang: l.unitPriceSatang, qty: l.qty })),
      payments: r.payments,
    };
    await enqueueOrder(payload); // จุดนี้บิลปลอดภัยแล้ว แม้เน็ตหลุด/ปิดแอป
    const results = await flushQueue();
    const res = results.get(payload.clientId);
    if (res?.status === 'rejected') {
      // เซิร์ฟเวอร์ไม่รับ — บิลถูกย้ายไปกอง "ต้องตรวจสอบ" แล้ว ไม่หาย
      throw new Error(`เซิร์ฟเวอร์ไม่รับบิล: ${res.error}`);
    }
    const cash = r.payments.find((p) => p.method === 'cash');
    const change = cash?.receivedSatang ? cash.receivedSatang - cash.amountSatang : 0;
    setDone({
      orderNo: res ? res.orderNo : null,
      pendingSync: !res,
      branchName: branch?.name ?? '',
      at: new Date(payload.occurredAt),
      cashier: user?.name ?? '',
      lines: snapshot.map((l) => ({ name: l.name, qty: l.qty, unitPriceSatang: l.unitPriceSatang })),
      subtotalSatang: subtotal,
      discountSatang: r.discountSatang,
      totalSatang: subtotal - r.discountSatang,
      payments: r.payments.map((p) => ({ ...p, changeSatang: p.method === 'cash' ? change : 0 })),
      changeSatang: change,
    });
    clear();
    setPayOpen(false);
    setCartOpen(false);
    qc.invalidateQueries({ queryKey: ['report'] });
  }

  const tableMode = !!(targetOrderId || targetTableId);

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3">
        {tableMode ? <Utensils size={18} className="text-brand-700" /> : <ShoppingBag size={18} className="text-brand-700" />}
        <div className="font-semibold">
          {tableMode ? `${targetOrderId ? 'เพิ่มเข้าบิล' : 'เปิดบิล'} โต๊ะ ${targetTable?.name ?? ''}` : 'ขายหน้าร้าน / กลับบ้าน'}
        </div>
        {lines.length > 0 && (
          <button onClick={clear} className="ml-auto text-sm text-stone-500 hover:text-red-600">
            ล้าง
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {lines.length === 0 ? (
          <Empty>
            <ScanBarcode className="mx-auto mb-2 text-stone-400" size={36} />
            แตะเมนูหรือสแกนบาร์โค้ดเพื่อเพิ่มรายการ
          </Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="text-sm text-stone-500 tabular">{baht(l.unitPriceSatang)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="rounded-lg bg-stone-100 p-1.5 hover:bg-stone-200" onClick={() => setQty(l.productId, l.qty - 1)} aria-label="ลด">
                    {l.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
                  </button>
                  <span className="w-7 text-center font-semibold tabular">{l.qty}</span>
                  <button className="rounded-lg bg-stone-100 p-1.5 hover:bg-stone-200" onClick={() => setQty(l.productId, l.qty + 1)} aria-label="เพิ่ม">
                    <Plus size={16} />
                  </button>
                </div>
                <div className="w-20 text-right font-medium tabular">{baht(l.unitPriceSatang * l.qty)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-3 border-t border-stone-200 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-stone-600">รวม {count} รายการ</span>
          <span className="text-2xl font-semibold tabular">{baht(subtotal)}</span>
        </div>
        {tableMode ? (
          <Button size="lg" className="w-full" disabled={!lines.length || busy} onClick={sendToTable}>
            {busy ? 'กำลังส่ง…' : 'ส่งเข้าบิล / ส่งครัว'}
          </Button>
        ) : (
          <>
            {noShift && (
              <p className="rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800">
                ยังไม่ได้เปิดกะ —{' '}
                <Link to="/shift" className="font-medium underline">
                  เปิดกะ
                </Link>{' '}
                ก่อนรับเงิน
              </p>
            )}
            <Button size="lg" className="w-full" disabled={!lines.length || noShift} onClick={() => setPayOpen(true)}>
              ชำระเงิน
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-stone-200 bg-white p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" size={18} />
            <Input
              ref={searchRef}
              className="pl-10"
              placeholder="ค้นหาเมนู / SKU / บาร์โค้ด (Enter เพื่อเพิ่ม)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const exact = byCode.get(q.trim()) ?? byCode.get(q.trim().toLowerCase());
                const p = exact ?? (visible.length === 1 ? visible[0] : undefined);
                if (p) {
                  add(p);
                  setQ('');
                }
              }}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[{ id: 'all', name: 'ทั้งหมด' }, ...(menu.data?.categories ?? [])].map((c) => (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className={cn(
                  'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium',
                  cat === c.id ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
          {menu.data?.fromCache && <p className="text-xs text-amber-700">ออฟไลน์ — ใช้เมนูที่บันทึกไว้ล่าสุด</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3 pb-24 lg:pb-3">
          {menu.isLoading ? (
            <Empty>กำลังโหลดเมนู…</Empty>
          ) : menu.isError ? (
            <Empty>โหลดเมนูไม่ได้: {(menu.error as Error).message}</Empty>
          ) : visible.length === 0 ? (
            <Empty>ไม่พบเมนู</Empty>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((p) => {
                const inCart = lines.find((l) => l.productId === p.id)?.qty;
                return (
                  <button
                    key={p.id}
                    onClick={() => add(p)}
                    className={cn(
                      'relative flex min-h-24 flex-col justify-between rounded-xl border bg-white p-3 text-left transition active:scale-[0.98]',
                      inCart ? 'border-brand-500 ring-2 ring-brand-100' : 'border-stone-200 hover:border-stone-300',
                    )}
                  >
                    <span className={cn('line-clamp-2 font-medium leading-snug', inCart && 'pr-7')}>{p.name}</span>
                    <span className="mt-2 text-lg font-semibold text-brand-700 tabular">{baht(p.priceSatang)}</span>
                    {inCart && (
                      <span className="absolute top-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-700 px-1.5 text-xs font-semibold text-white">
                        {inCart}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ตะกร้า: แผงขวาบนจอใหญ่ */}
      <aside className="hidden w-[380px] shrink-0 border-l border-stone-200 bg-white lg:block">{cartPanel}</aside>

      {/* ตะกร้า: แถบล่าง + หน้าต่างบนจอเล็ก */}
      <div className="fixed inset-x-0 bottom-14 z-30 p-3 md:bottom-0 md:left-20 lg:hidden">
        <Button size="lg" className="w-full justify-between shadow-lg" onClick={() => setCartOpen(true)} disabled={!lines.length}>
          <span>ตะกร้า {count} รายการ</span>
          <span className="tabular">{baht(subtotal)}</span>
        </Button>
      </div>
      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="ตะกร้า">
        <div className="-m-5 h-[70vh]">{cartPanel}</div>
      </Modal>

      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} subtotalSatang={subtotal} onConfirm={payTakeaway} />

      <Modal open={!!done} onClose={() => setDone(null)} title="ชำระเงินสำเร็จ">
        {done && (
          <div className="space-y-4 text-center">
            {done.changeSatang > 0 && (
              <div className="rounded-xl bg-amber-50 p-4">
                <div className="text-sm text-amber-800">เงินทอน</div>
                <div className="text-4xl font-semibold text-amber-900 tabular">{baht(done.changeSatang)}</div>
              </div>
            )}
            <div className="text-stone-600">
              {done.orderNo ? (
                <>
                  เลขที่บิล <span className="font-semibold text-stone-900">{done.orderNo}</span>
                </>
              ) : (
                'บันทึกบิลไว้ในเครื่องแล้ว จะส่งขึ้นระบบอัตโนมัติเมื่อกลับมาออนไลน์'
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                พิมพ์ใบเสร็จ
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setDone(null);
                  searchRef.current?.focus();
                }}
              >
                บิลถัดไป
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <Receipt data={done} />
    </div>
  );
}
