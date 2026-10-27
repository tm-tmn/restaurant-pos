import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, cn, Empty, Input, Label, Modal } from '../components/ui';
import { api } from '../lib/api';
import { baht, parseBahtToSatang } from '../lib/money';
import { useAuth } from '../store/auth';
import { useToast } from '../store/toast';
import type { Branch, Category, Product, StaffUser, TableInfo } from '../types';

const TABS = [
  { id: 'menu', label: 'เมนู' },
  { id: 'tables', label: 'โต๊ะ' },
  { id: 'staff', label: 'พนักงาน' },
  { id: 'store', label: 'ตั้งค่าร้าน' },
] as const;

export function ManagePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('menu');
  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex gap-1 rounded-xl bg-stone-200 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex-1 rounded-lg py-2 text-sm font-medium', tab === t.id ? 'bg-white shadow-sm' : 'text-stone-600')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'menu' && <MenuTab />}
      {tab === 'tables' && <TablesTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'store' && <StoreTab />}
    </div>
  );
}

function useSave() {
  const toast = useToast((s) => s.show);
  const [busy, setBusy] = useState(false);
  async function save(fn: () => Promise<unknown>, ok = 'บันทึกแล้ว') {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (e) {
      toast((e as Error).message, 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, save };
}

// ---------------- เมนู ----------------
function MenuTab() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['manage-menu'], queryFn: () => api<{ categories: Category[]; products: Product[] }>('/catalog/manage') });
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [newCat, setNewCat] = useState('');
  const { busy, save } = useSave();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['manage-menu'] });
    qc.invalidateQueries({ queryKey: ['menu'] });
  };

  if (data.isLoading) return <Empty>กำลังโหลด…</Empty>;
  if (data.isError) return <Empty>{(data.error as Error).message}</Empty>;
  const { categories, products } = data.data!;
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 font-semibold">หมวดหมู่</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              title={c.active ? 'แตะเพื่อปิดหมวด' : 'แตะเพื่อเปิดหมวด'}
              onClick={() => save(() => api(`/catalog/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } })).then(refresh)}
              className={cn('rounded-full px-3 py-1 text-sm', c.active ? 'bg-brand-100 text-brand-800' : 'bg-stone-100 text-stone-400 line-through')}
            >
              {c.name}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save(() => api('/catalog/categories', { body: { name: newCat.trim(), sortOrder: categories.length } }))) {
              setNewCat('');
              refresh();
            }
          }}
        >
          <Input placeholder="ชื่อหมวดหมู่ใหม่" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!newCat.trim() || busy}>
            เพิ่ม
          </Button>
        </form>
      </Card>

      <Card>
        <div className="flex items-center border-b border-stone-200 p-4">
          <h2 className="font-semibold">รายการเมนู ({products.length})</h2>
          <Button size="sm" className="ml-auto" onClick={() => setEditing({ active: true, categoryId: categories[0]?.id ?? null })}>
            <Plus size={16} /> เพิ่มเมนู
          </Button>
        </div>
        <ul className="divide-y divide-stone-100">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className={cn('font-medium', !p.active && 'text-stone-400 line-through')}>{p.name}</div>
                <div className="text-xs text-stone-500">
                  {catName.get(p.categoryId ?? '') ?? 'ไม่มีหมวด'}
                  {p.barcode && ` · ${p.barcode}`}
                </div>
              </div>
              {!p.active && <Badge>ปิดขาย</Badge>}
              <span className="tabular">{baht(p.priceSatang)}</span>
              <button className="rounded-lg p-1.5 hover:bg-stone-100" onClick={() => setEditing(p)} aria-label={`แก้ไข ${p.name}`}>
                <Pencil size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {editing && (
        <ProductForm
          initial={editing}
          categories={categories}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await save(() =>
              editing.id ? api(`/catalog/products/${editing.id}`, { method: 'PATCH', body }) : api('/catalog/products', { body }),
            );
            if (ok) {
              setEditing(null);
              refresh();
            }
          }}
        />
      )}
    </div>
  );
}

function ProductForm({
  initial,
  categories,
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Product>;
  categories: Category[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: object) => void;
}) {
  const [name, setName] = useState(initial.name ?? '');
  const [price, setPrice] = useState(initial.priceSatang !== undefined ? String(initial.priceSatang / 100) : '');
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? '');
  const [barcode, setBarcode] = useState(initial.barcode ?? '');
  const [sku, setSku] = useState(initial.sku ?? '');
  const [active, setActive] = useState(initial.active ?? true);
  const priceSatang = parseBahtToSatang(price);

  return (
    <Modal open onClose={onClose} title={initial.id ? 'แก้ไขเมนู' : 'เพิ่มเมนู'}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (priceSatang === null) return;
          onSave({ name: name.trim(), priceSatang, categoryId: categoryId || undefined, barcode, sku, active });
        }}
      >
        <div>
          <Label>ชื่อเมนู</Label>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>ราคา (บาท)</Label>
            <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <Label>หมวดหมู่</Label>
            <select className="h-10 w-full rounded-lg border border-stone-300 bg-white px-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— ไม่มี —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>บาร์โค้ด</Label>
            {/* data-scan-target: ยิงเครื่องสแกนเข้าช่องนี้ได้โดยตรง */}
            <Input data-scan-target value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </div>
          <div>
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-brand-700" />
          เปิดขาย
        </label>
        <Button type="submit" className="w-full" disabled={!name.trim() || priceSatang === null || busy}>
          บันทึก
        </Button>
      </form>
    </Modal>
  );
}

// ---------------- โต๊ะ ----------------
function TablesTab() {
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: ['tables'], queryFn: () => api<TableInfo[]>('/tables') });
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('4');
  const { busy, save } = useSave();

  return (
    <Card className="p-4">
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => api('/tables', { body: { name: name.trim(), seats: Number(seats) || 4 } }))) {
            setName('');
            qc.invalidateQueries({ queryKey: ['tables'] });
          }
        }}
      >
        <Input placeholder="ชื่อโต๊ะ เช่น T9, A1" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="w-24" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} aria-label="จำนวนที่นั่ง" />
        <Button type="submit" disabled={!name.trim() || busy}>
          เพิ่ม
        </Button>
      </form>
      <ul className="divide-y divide-stone-100">
        {tables.data?.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <span className="flex-1 font-medium">{t.name}</span>
            <span className="text-sm text-stone-500">{t.seats} ที่นั่ง</span>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-600"
              disabled={!!t.openOrder || busy}
              title={t.openOrder ? 'โต๊ะมีบิลเปิดอยู่' : undefined}
              onClick={() => save(() => api(`/tables/${t.id}`, { method: 'PATCH', body: { active: false } }), 'ปิดใช้งานโต๊ะแล้ว').then(() => qc.invalidateQueries({ queryKey: ['tables'] }))}
            >
              ปิดใช้งาน
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------- พนักงาน ----------------
const ROLE_TH = { owner: 'เจ้าของ', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์' };

function StaffTab() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<StaffUser[]>('/users') });
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'cashier' });
  const [pwFor, setPwFor] = useState<StaffUser | null>(null);
  const [pw, setPw] = useState('');
  const { busy, save } = useSave();
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  return (
    <div className="space-y-4">
      <Card>
        <ul className="divide-y divide-stone-100">
          {users.data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className={cn('font-medium', !u.active && 'text-stone-400 line-through')}>{u.displayName}</div>
                <div className="text-xs text-stone-500">{u.username}</div>
              </div>
              <Badge tone={u.role === 'cashier' ? 'stone' : 'brand'}>{ROLE_TH[u.role]}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setPwFor(u)}>
                ตั้งรหัสผ่าน
              </Button>
              {u.id !== me?.id && u.role !== 'owner' && (
                <Button size="sm" variant="ghost" onClick={() => save(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } })).then(refresh)}>
                  {u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 font-semibold">เพิ่มพนักงาน</h2>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save(() => api('/users', { body: form }))) {
              setForm({ username: '', displayName: '', password: '', role: 'cashier' });
              refresh();
            }
          }}
        >
          <div>
            <Label>ชื่อที่แสดง</Label>
            <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div>
            <Label>ชื่อผู้ใช้ (a-z, 0-9)</Label>
            <Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div>
            <Label>รหัสผ่าน (อย่างน้อย 8 ตัว)</Label>
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div>
            <Label>ตำแหน่ง</Label>
            <select className="h-10 w-full rounded-lg border border-stone-300 bg-white px-2" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="cashier">แคชเชียร์</option>
              {me?.role === 'owner' && <option value="manager">ผู้จัดการ</option>}
            </select>
          </div>
          <Button type="submit" className="sm:col-span-2" disabled={busy || !form.username || !form.displayName || form.password.length < 8}>
            เพิ่มพนักงาน
          </Button>
        </form>
      </Card>

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`ตั้งรหัสผ่าน: ${pwFor?.displayName ?? ''}`}>
        <Input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" />
        <Button
          className="mt-4 w-full"
          disabled={pw.length < 8 || busy}
          onClick={async () => {
            if (await save(() => api(`/users/${pwFor!.id}`, { method: 'PATCH', body: { password: pw } }), 'เปลี่ยนรหัสผ่านแล้ว')) {
              setPw('');
              setPwFor(null);
            }
          }}
        >
          บันทึก
        </Button>
      </Modal>
    </div>
  );
}

// ---------------- ตั้งค่าร้าน ----------------
function StoreTab() {
  const { branch, setBranch, user } = useAuth();
  const [name, setName] = useState(branch?.name ?? '');
  const [pp, setPp] = useState(branch?.promptpayId ?? '');
  const { busy, save } = useSave();

  return (
    <Card className="space-y-3 p-4">
      <div>
        <Label>ชื่อร้าน / สาขา (แสดงบนใบเสร็จ)</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label>PromptPay ID ของร้าน</Label>
        <Input inputMode="numeric" value={pp} onChange={(e) => setPp(e.target.value)} placeholder="เบอร์โทร 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก" />
        <p className="mt-1 text-xs text-stone-500">ใช้สร้าง QR รับเงินพร้อมยอด — ตรวจให้ตรงกับบัญชีที่ผูก PromptPay ของร้าน</p>
      </div>
      <Button
        disabled={busy || !name.trim()}
        onClick={() => save(async () => setBranch(await api<Branch>('/branches/me', { method: 'PATCH', body: { name: name.trim(), promptpayId: pp } })))}
      >
        บันทึก
      </Button>
      {user?.role === 'owner' && <BranchesSection />}
    </Card>
  );
}

function BranchesSection() {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; code: string; name: string }[]>('/branches') });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const { busy, save } = useSave();
  return (
    <div className="mt-4 border-t border-stone-200 pt-4">
      <h3 className="mb-2 font-semibold">สาขาทั้งหมด</h3>
      <ul className="mb-3 space-y-1 text-sm">
        {branches.data?.map((b) => (
          <li key={b.id}>
            <span className="font-mono text-stone-500">{b.code}</span> · {b.name}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save(() => api('/branches', { body: { code: code.trim().toUpperCase(), name: name.trim() } }), 'เพิ่มสาขาแล้ว')) {
            setCode('');
            setName('');
            qc.invalidateQueries({ queryKey: ['branches'] });
          }
        }}
      >
        <Input className="w-28" placeholder="รหัส เช่น B2" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input className="min-w-40 flex-1" placeholder="ชื่อสาขา" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline" disabled={busy || !code.trim() || !name.trim()}>
          เพิ่มสาขา
        </Button>
      </form>
      <p className="mt-2 text-xs text-stone-500">ใช้เป็นปลายทางการโอนสต็อก · การจัดการหลายสาขาเต็มรูปแบบอยู่ใน Phase 4</p>
    </div>
  );
}
