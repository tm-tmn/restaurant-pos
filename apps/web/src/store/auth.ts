import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Branch, Role, SessionUser } from '../types';

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  branch: Branch | null;
  setSession: (s: { token: string; user: SessionUser; branch: Branch }) => void;
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
      setSession: (s) => set(s),
      setBranch: (branch) => set({ branch }),
      setUser: (user) => set({ user }),
      // ออกจากระบบไม่ลบคิวออเดอร์ offline (เก็บใน IndexedDB แยกต่างหาก) — ซิงค์ต่อหลังเข้าสู่ระบบใหม่
      logout: () => set({ token: null, user: null, branch: null }),
    }),
    { name: 'pos-auth' },
  ),
);

export const isManager = (r?: Role) => r === 'owner' || r === 'manager';
