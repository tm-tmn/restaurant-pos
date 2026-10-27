import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Label } from '../components/ui';
import { api, NetworkError } from '../lib/api';
import { flushQueue } from '../lib/offline';
import { useAuth } from '../store/auth';
import type { Branch, SessionUser } from '../types';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: SessionUser; branch: Branch }>('/auth/login', { body: { username, password } });
      setSession(r);
      void flushQueue(); // ส่งบิลที่ค้างจากก่อนหน้า
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof NetworkError ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — การเข้าสู่ระบบครั้งแรกต้องออนไลน์' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-800 to-stone-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <img src="/icon.svg" alt="" className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-center text-2xl font-semibold">Restaurant POS</h1>
        <p className="mb-6 text-center text-sm text-stone-500">เข้าสู่ระบบเพื่อเริ่มขาย</p>
        <div className="space-y-4">
          <div>
            <Label>ชื่อผู้ใช้</Label>
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <Label>รหัสผ่าน</Label>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !username || !password}>
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </Button>
        </div>
      </form>
    </div>
  );
}
