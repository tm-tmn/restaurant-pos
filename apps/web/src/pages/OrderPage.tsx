import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PaymentDialog, type PaymentResult } from '../components/PaymentDialog';
import { Receipt, type ReceiptData } from '../components/Receipt';
import { Badge, Button, Card, Empty, Input, Label, Modal } from '../components/ui';
import { api } from '../lib/api';
import { baht } from '../lib/money';
import { isManager, useAuth } from '../store/auth';
import { useToast } from '../store/toast';
import type { Order, Shift } from '../types';

export function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const { user, branch } = useAuth();
  const manager = isManager(user?.role);

  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<Order>(`/orders/${id}`),
    // บิลเปิดอยู่: ดึงใหม่ทุก 5 วินาที เห็นรายการที่ลูกค้าสั่งเพิ่ม/เงินเข้าอัตโนมัติ
    refetchInterval: (q) => (q.state.data?.status === 'open' ? 5_000 : false),
  });
  const shift = useQuery({ queryKey: ['shift'], queryFn: () => api<Shift | null>('/shifts/current'), retry: false });
  const [payOpen, setPayOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{ kind: 'order' } | { kind: 'item'; itemId: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  if (order.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (order.isError) return <Empty>{(order.error as Error).message}</Empty>;
  const o = order.data!;
  const active = o.items.filter((i) => i.status === 'active');
  const pendingItems = o.items.filter((i) => i.status === 'pending');
  const refresh = (next: Order) => {
    qc.setQueryData(['order', id], next);
    qc.invalidateQueries({ queryKey: ['tables'] });
  };

  function finishPaid(next: Order) {
    refresh(next);
    setPayOpen(false);
    const change = next.payments.reduce((s, p) => s + p.changeSatang, 0);
    toast(change > 0 ? `ชำระแล้ว · เงินทอน ${baht(change)}` : 'ชำระเงินเรียบร้อย');
    setReceipt({
      orderNo: next.orderNo,
      branchName: branch?.name ?? '',
      at: next.paidAt ? new Date(next.paidAt) : new Date(),
      cashier: user?.name ?? '',
      lines: next.items.filter((i) => i.status === 'active').map((i) => ({ name: i.nameSnapshot, qty: i.qty, unitPriceSatang: i.unitPriceSatang })),
      subtotalSatang: next.subtotalSatang,
      discountSatang: next.discountSatang,
      totalSatang: next.totalSatang,
      payments: next.payments,
    });
  }

  async function pay(r: PaymentResult) {
    finishPaid(await api<Order>(`/orders/${id}/pay`, { body: r }));
  }

  /** ระบบปิดบิลให้แล้วจากเงิน PromptPay เข้า — โหลดบิลล่าสุดมาแสดง */
  async function paidAuto() {
    finishPaid(await api<Order>(`/orders/${id}`));
  }

  async function decidePending(action: 'approve' | 'reject') {
    setBusy(true);
    try {
      refresh(await api<Order>(`/orders/${id}/pending/${action}`, { body: action === 'reject' ? { reason: 'ปฏิเสธโดยพนักงาน' } : {} }));
      qc.invalidateQueries({ queryKey: ['pending'] });
      toast(action === 'approve' ? 'ยืนยันแล้ว ส่งเข้าครัว' : 'ปฏิเสธรายการแล้ว');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setBusy(true);
    try {
      const path = voidTarget.kind === 'order' ? `/orders/${id}/void` : `/orders/${id}/items/${voidTarget.itemId}/void`;
      refresh(await api<Order>(path, { body: { reason } }));
      setVoidTarget(null);
      setReason('');
      toast('ยกเลิกแล้ว');
      if (voidTarget.kind === 'order') nav('/tables');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const statusBadge = { open: <Badge tone="amber">เปิดอยู่</Badge>, paid: <Badge tone="green">ชำระแล้ว</Badge>, void: <Badge tone="red">ยกเลิก</Badge> }[o.status];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <Link to="/tables" className="mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft size={16} /> โต๊ะทั้งหมด
      </Link>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-stone-200 p-4">
          <h1 className="text-xl font-semibold">{o.orderNo}</h1>
          {statusBadge}
          {o.status === 'open' && (
            <Button variant="outline" size="sm" className="ml-auto" onClick={() => nav(`/?order=${o.id}`)}>
              <Plus size={16} /> เพิ่มรายการ
            </Button>
          )}
        </div>
        {pendingItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-medium">ลูกค้าสั่งผ่าน QR {pendingItems.length} รายการ รอยืนยัน</span>
            <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => confirm('ปฏิเสธรายการที่ลูกค้าสั่งทั้งหมด?') && decidePending('reject')}>
              ปฏิเสธ
            </Button>
            <Button size="sm" disabled={busy} onClick={() => decidePending('approve')}>
              ยืนยัน ส่งเข้าครัว
            </Button>
          </div>
        )}
        <ul className="divide-y divide-stone-100">
          {o.items.map((i) => (
            <li key={i.id} className={`flex items-center gap-3 px-4 py-3 ${i.status === 'void' ? 'text-stone-400' : ''}`}>
              <span className="w-8 text-right font-semibold tabular">{i.qty}×</span>
              <div className="min-w-0 flex-1">
                <div className={i.status === 'void' ? 'line-through' : 'font-medium'}>{i.nameSnapshot}</div>
                {i.note && <div className="text-xs text-stone-500">{i.note}</div>}
                {i.status === 'void' && <div className="text-xs">ยกเลิก: {i.voidReason}</div>}
                {i.status === 'pending' && <Badge tone="amber">รอยืนยัน</Badge>}
                {i.status === 'active' && i.source === 'customer' && <Badge tone="brand">ลูกค้าสั่งเอง</Badge>}
              </div>
              <span className="tabular">{i.status === 'pending' ? '' : baht(i.unitPriceSatang * i.qty)}</span>
              {o.status === 'open' && i.status === 'active' && manager && (
                <button
                  className="rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setVoidTarget({ kind: 'item', itemId: i.id, name: i.nameSnapshot })}
                  aria-label={`ยกเลิก ${i.nameSnapshot}`}
                >
                  <XCircle size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-stone-200 p-4">
          {o.discountSatang > 0 && (
            <div className="flex justify-between text-sm text-red-600">
              <span>ส่วนลด</span>
              <span className="tabular">-{baht(o.discountSatang)}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between">
            <span className="text-stone-600">ยอดสุทธิ</span>
            <span className="text-3xl font-semibold tabular">{baht(o.totalSatang)}</span>
          </div>
          {o.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm text-stone-600">
              <span>{{ cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร' }[p.method]}</span>
              <span className="tabular">
                {baht(p.receivedSatang)}
                {p.changeSatang > 0 && ` · ทอน ${baht(p.changeSatang)}`}
              </span>
            </div>
          ))}
        </div>
        {o.status === 'open' && (
          <div className="flex flex-col gap-2 border-t border-stone-200 p-4 sm:flex-row">
            {manager && (
              <Button variant="ghost" className="text-red-600" onClick={() => setVoidTarget({ kind: 'order' })}>
                ยกเลิกบิล
              </Button>
            )}
            {pendingItems.length > 0 && <p className="self-center text-sm text-amber-700">ยืนยันหรือปฏิเสธรายการที่ลูกค้าสั่งก่อนชำระ</p>}
            {shift.isSuccess && shift.data === null && (
              <p className="self-center text-sm text-amber-700">
                ยังไม่ได้เปิดกะ — <Link to="/shift" className="underline">เปิดกะ</Link>
              </p>
            )}
            <Button size="lg" className="sm:ml-auto sm:w-56" disabled={!active.length || pendingItems.length > 0 || (shift.isSuccess && shift.data === null)} onClick={() => setPayOpen(true)}>
              ชำระเงิน
            </Button>
          </div>
        )}
        {o.status === 'paid' && (
          <div className="border-t border-stone-200 p-4">
            <Button
              variant="outline"
              onClick={() => {
                setReceipt({
                  orderNo: o.orderNo,
                  branchName: branch?.name ?? '',
                  at: o.paidAt ? new Date(o.paidAt) : new Date(),
                  cashier: user?.name ?? '',
                  lines: active.map((i) => ({ name: i.nameSnapshot, qty: i.qty, unitPriceSatang: i.unitPriceSatang })),
                  subtotalSatang: o.subtotalSatang,
                  discountSatang: o.discountSatang,
                  totalSatang: o.totalSatang,
                  payments: o.payments,
                });
                setTimeout(() => window.print(), 50);
              }}
            >
              พิมพ์ใบเสร็จ
            </Button>
          </div>
        )}
      </Card>

      <PaymentDialog open={payOpen} onClose={() => setPayOpen(false)} subtotalSatang={o.subtotalSatang} onConfirm={pay} orderId={o.id} onPaidAuto={paidAuto} />

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title={voidTarget?.kind === 'order' ? 'ยกเลิกทั้งบิล' : 'ยกเลิกรายการ'}>
        <p className="mb-3 text-stone-600">
          {voidTarget?.kind === 'item' ? `ยกเลิก "${voidTarget.name}"` : `ยกเลิกบิล ${o.orderNo} ทั้งหมด`} — ระบบจะบันทึกประวัติพร้อมเหตุผลและผู้ดำเนินการ
        </p>
        <Label>เหตุผล</Label>
        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าเปลี่ยนใจ, สั่งผิด" />
        <Button variant="danger" className="mt-4 w-full" disabled={reason.trim().length < 3 || busy} onClick={confirmVoid}>
          ยืนยันการยกเลิก
        </Button>
      </Modal>
      <Receipt data={receipt} />
    </div>
  );
}
