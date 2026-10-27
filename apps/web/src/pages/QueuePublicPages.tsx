import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Label } from '../components/ui';
import { api, ApiError } from '../lib/api';

const TICKET_KEY = (branch: string) => `pos-queue-ticket:${branch}`;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* โหมดส่วนตัว — ไม่เป็นไร ลูกค้ายังเปิดลิงก์คิวได้จาก URL */
  }
};

/** ลูกค้าเข้าคิวเองผ่าน QR หน้าร้าน */
export function QueueJoinPage() {
  const { branchCode = '' } = useParams();
  const nav = useNavigate();
  const [size, setSize] = useState('2');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const existing = read(TICKET_KEY(branchCode));

  useEffect(() => {
    if (existing) nav(`/q/ticket/${existing}`, { replace: true });
  }, [existing, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ token: string }>(`/public/queue/${branchCode}`, {
        auth: false,
        body: { partySize: Number(size) || 1, ...(name.trim() ? { name: name.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) },
      });
      write(TICKET_KEY(branchCode), r.token);
      nav(`/q/ticket/${r.token}`, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-6">
      <h1 className="text-2xl font-semibold">เข้าคิวรอโต๊ะ</h1>
      <p className="mb-5 text-stone-600">กรอกจำนวนคน แล้วรับเลขคิวทันที ไม่ต้องยืนรอหน้าร้าน</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>จำนวนคน</Label>
          <Input type="number" min={1} max={30} inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
        </div>
        <div>
          <Label>ชื่อ (ไม่บังคับ)</Label>
          <Input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>เบอร์โทร (ไม่บังคับ — ใช้ติดต่อเมื่อถึงคิว)</Label>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <Button size="lg" className="w-full" disabled={busy}>
          {busy ? 'กำลังออกคิว…' : 'รับบัตรคิว'}
        </Button>
      </form>
    </div>
  );
}

interface TicketStatus {
  code: string;
  partySize: number;
  status: 'waiting' | 'called' | 'seated' | 'cancelled' | 'no_show';
  aheadCount: number;
  calling: string[];
}

/** สถานะคิวของลูกค้า — โพลทุก 5 วินาที */
export function QueueTicketPage() {
  const { token = '' } = useParams();
  const q = useQuery({
    queryKey: ['ticket', token],
    queryFn: () => api<TicketStatus>(`/public/queue/ticket/${token}`, { auth: false }),
    refetchInterval: (query) => (query.state.data && ['seated', 'cancelled', 'no_show'].includes(query.state.data.status) ? false : 5_000),
    retry: (n, e) => !(e instanceof ApiError) && n < 2,
  });
  const [cancelling, setCancelling] = useState(false);
  const t = q.data;

  useEffect(() => {
    if (t?.status === 'called') navigator.vibrate?.([200, 100, 200]);
  }, [t?.status]);

  if (q.isLoading) return <Box>กำลังโหลด…</Box>;
  if (q.isError) return <Box>{q.error instanceof ApiError ? 'ไม่พบคิวนี้' : 'เชื่อมต่อไม่ได้ กรุณาลองใหม่'}</Box>;
  const d = t!;
  const done = d.status === 'seated' || d.status === 'cancelled' || d.status === 'no_show';

  return (
    <Box>
      <div className="text-sm text-stone-500">เลขคิวของคุณ</div>
      <div className="my-2 text-7xl font-semibold tabular text-brand-700">{d.code}</div>
      <div className="text-stone-600">{d.partySize} ท่าน</div>

      {d.status === 'waiting' && (
        <div className="mt-6 rounded-2xl bg-stone-100 p-4">
          <div className="text-3xl font-semibold tabular">{d.aheadCount}</div>
          <div className="text-stone-600">คิวก่อนหน้าคุณ</div>
          {d.calling.length > 0 && <div className="mt-2 text-sm text-stone-500">กำลังเรียก: {d.calling.join(', ')}</div>}
        </div>
      )}
      {d.status === 'called' && (
        <div role="alert" className="mt-6 rounded-2xl bg-amber-100 p-5 text-amber-900">
          <div className="text-2xl font-semibold">ถึงคิวคุณแล้ว!</div>
          <div>กรุณาแจ้งพนักงานที่หน้าร้าน</div>
        </div>
      )}
      {d.status === 'seated' && <div className="mt-6 rounded-2xl bg-green-100 p-4 text-green-800">จัดโต๊ะให้แล้ว ขอบคุณที่รอ</div>}
      {d.status === 'cancelled' && <div className="mt-6 rounded-2xl bg-stone-100 p-4 text-stone-600">คิวนี้ถูกยกเลิก</div>}
      {d.status === 'no_show' && <div className="mt-6 rounded-2xl bg-stone-100 p-4 text-stone-600">คิวนี้ถูกข้าม เนื่องจากไม่พบตัวเมื่อเรียก</div>}

      {!done && (
        <Button
          variant="ghost"
          className="mt-6 text-red-600"
          disabled={cancelling}
          onClick={async () => {
            if (!confirm('ยกเลิกคิวนี้?')) return;
            setCancelling(true);
            try {
              await api(`/public/queue/ticket/${token}/cancel`, { auth: false, body: {} });
              await q.refetch();
            } finally {
              setCancelling(false);
            }
          }}
        >
          ยกเลิกคิว
        </Button>
      )}
      {done && (
        <Link to="/" className="mt-6 block text-sm text-stone-500 underline" onClick={() => Object.keys(localStorage).filter((k) => k.startsWith('pos-queue-ticket:')).forEach((k) => write(k, null))}>
          เสร็จสิ้น
        </Link>
      )}
    </Box>
  );
}

/** จอแสดงคิวหน้าร้าน (ทีวี/แท็บเล็ต) */
export function QueueBoardPage() {
  const { branchCode = '' } = useParams();
  const q = useQuery({
    queryKey: ['board', branchCode],
    queryFn: () => api<{ branch: string; calling: string[]; waiting: number }>(`/public/queue/${branchCode}/board`, { auth: false }),
    refetchInterval: 4_000,
  });
  const d = q.data;
  return (
    <div className="grid min-h-full place-items-center bg-stone-900 p-8 text-center text-white">
      {!d ? (
        <div className="text-2xl text-stone-400">{q.isError ? 'ไม่พบสาขา หรือเชื่อมต่อไม่ได้' : 'กำลังโหลด…'}</div>
      ) : (
        <div>
          <div className="text-2xl text-stone-300">{d.branch}</div>
          <div className="mt-6 text-3xl">กำลังเรียกคิว</div>
          <div className="mt-4 flex flex-wrap justify-center gap-6" aria-live="polite">
            {d.calling.length ? d.calling.map((c) => <span key={c} className="text-[8rem] font-semibold leading-none tabular text-amber-300">{c}</span>) : <span className="text-5xl text-stone-500">—</span>}
          </div>
          <div className="mt-12 text-2xl text-stone-300">
            คิวที่รออยู่ <span className="text-4xl font-semibold text-white tabular">{d.waiting}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center p-6 text-center">{children}</div>;
}
