import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Monitor, Users } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Input, Label } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useToast } from '../store/toast';
import type { QueueTicket, TableInfo } from '../types';

/** จัดการคิวรอโต๊ะ (พนักงาน) */
export function QueuePage() {
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const branch = useAuth((s) => s.branch);
  const list = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueTicket[]>('/queue'), refetchInterval: 5_000 });
  const tables = useQuery({ queryKey: ['tables'], queryFn: () => api<TableInfo[]>('/tables') });
  const [size, setSize] = useState('2');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [seatFor, setSeatFor] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const joinUrl = branch ? `${location.origin}/q/${branch.code}` : '';

  useEffect(() => {
    if (joinUrl) QRCode.toDataURL(joinUrl, { margin: 1, width: 220 }).then(setQr, () => setQr(null));
  }, [joinUrl]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      await qc.invalidateQueries({ queryKey: ['queue'] });
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const waiting = list.data?.filter((t) => t.status === 'waiting') ?? [];
  const called = list.data?.filter((t) => t.status === 'called') ?? [];
  const freeTables = tables.data?.filter((t) => !t.openOrder) ?? [];

  const row = (t: QueueTicket) => (
    <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="w-16 text-2xl font-semibold tabular">{t.code}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          <Users size={16} className="text-stone-400" /> {t.partySize} ท่าน {t.name && <span className="truncate text-stone-600">· {t.name}</span>}
          {t.source === 'customer' && <Badge tone="brand">เข้าคิวเอง</Badge>}
        </div>
        <div className="text-xs text-stone-500">
          {t.phone && <span>{t.phone} · </span>}
          รอมา {Math.max(0, Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60_000))} นาที
          {t.callCount > 0 && ` · เรียกแล้ว ${t.callCount} ครั้ง`}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={t.status === 'called' ? 'outline' : 'primary'} disabled={busy} onClick={() => act(() => api(`/queue/${t.id}/call`, { body: {} }), `เรียก ${t.code}`)}>
          <Megaphone size={14} /> {t.status === 'called' ? 'เรียกซ้ำ' : 'เรียกคิว'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setSeatFor(seatFor === t.id ? null : t.id)}>
          จัดโต๊ะ
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api(`/queue/${t.id}/no-show`, { body: {} }), `${t.code} ไม่มา`)}>
          ไม่มา
        </Button>
        <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => act(() => api(`/queue/${t.id}/cancel`, { body: {} }), `ยกเลิก ${t.code}`)}>
          ยกเลิก
        </Button>
      </div>
      {seatFor === t.id && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-stone-50 p-2 text-sm">
          <span className="text-stone-600">นั่งโต๊ะ:</span>
          {freeTables.length === 0 && <span className="text-stone-500">ไม่มีโต๊ะว่าง</span>}
          {freeTables.map((tb) => (
            <Button key={tb.id} size="sm" variant="outline" disabled={busy} onClick={() => act(() => api(`/queue/${t.id}/seat`, { body: { tableId: tb.id } }), `${t.code} → โต๊ะ ${tb.name}`).then(() => setSeatFor(null))}>
              {tb.name} <span className="text-stone-400">({tb.seats})</span>
            </Button>
          ))}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api(`/queue/${t.id}/seat`, { body: {} }), `${t.code} นั่งแล้ว`).then(() => setSeatFor(null))}>
            ไม่ระบุโต๊ะ
          </Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">เพิ่มคิว</h2>
          <form
            className="grid gap-2 sm:grid-cols-[90px_1fr_1fr_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act(
                () => api('/queue', { body: { partySize: Number(size) || 1, ...(name.trim() ? { name: name.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) } }),
                'เพิ่มคิวแล้ว',
              );
              if (ok) {
                setName('');
                setPhone('');
              }
            }}
          >
            <div>
              <Label>จำนวนคน</Label>
              <Input type="number" min={1} max={30} value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div>
              <Label>ชื่อ (ไม่บังคับ)</Label>
              <Input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>เบอร์โทร (ไม่บังคับ)</Label>
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button type="submit" className="self-end" disabled={busy}>
              ออกคิว
            </Button>
          </form>
        </Card>

        {called.length > 0 && (
          <Card>
            <h2 className="border-b border-stone-200 px-4 py-2 font-semibold text-amber-800">เรียกแล้ว · รอลูกค้า ({called.length})</h2>
            <ul className="divide-y divide-stone-100">{called.map(row)}</ul>
          </Card>
        )}
        <Card>
          <h2 className="border-b border-stone-200 px-4 py-2 font-semibold">กำลังรอ ({waiting.length})</h2>
          {list.isLoading ? <Empty>กำลังโหลด…</Empty> : waiting.length === 0 ? <Empty>ไม่มีคิวรอ</Empty> : <ul className="divide-y divide-stone-100">{waiting.map(row)}</ul>}
        </Card>
      </div>

      <Card className="h-fit space-y-3 p-4 text-center">
        <h2 className="font-semibold">ให้ลูกค้าเข้าคิวเอง</h2>
        {qr ? <img src={qr} alt="QR เข้าคิว" className="mx-auto h-44 w-44" /> : <div className="mx-auto h-44 w-44 animate-pulse rounded bg-stone-100" />}
        <p className="break-all text-xs text-stone-500">{joinUrl}</p>
        <Button variant="outline" className="w-full" onClick={() => window.open(`/board/${branch?.code}`, '_blank')}>
          <Monitor size={16} /> เปิดจอแสดงคิว
        </Button>
        <p className="text-xs text-stone-500">เปิดจอแสดงคิวบนทีวี/แท็บเล็ตหน้าร้าน ลูกค้าจะเห็นเลขที่กำลังถูกเรียก</p>
      </Card>
    </div>
  );
}
