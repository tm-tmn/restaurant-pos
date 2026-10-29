import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Branch, Role, SessionUser, TenantInfo } from '../types';

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  branch: Branch | null;
  tenant: TenantInfo | null;
  /** รหัสร้านล่าสุดที่ใช้ล็อกอินบนเครื่องนี้ (เติมให้อัตโนมัติ — ไม่ลบตอนออกจากระบบ) */
  lastTenant: string;
  setSession: (s: { token: string; user: SessionUser; branch: Branch; tenant: TenantInfo }) => void;
  setTenant: (t: TenantInfo) => void;
  setBranch: (b: Branch) => void;
  setUser: (u: SessionUser) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      branch: null,
      tenant: null,
      lastTenant: '',
      setSession: (s) => set({ ...s, lastTenant: s.tenant.slug }),
      setTenant: (tenant) => set({ tenant }),
      setBranch: (branch) => set({ branch }),
      setUser: (user) => set({ user }),
      // ออกจากระบบไม่ลบคิวออเดอร์ offline (เก็บใน IndexedDB แยกต่างหาก) — ซิงค์ต่อหลังเข้าสู่ระบบใหม่
      logout: () => set({ token: null, user: null, branch: null, tenant: null }),
    }),
    { name: 'pos-auth' },
  ),
);

export const isManager = (r?: Role) => r === 'owner' || r === 'manager';
