import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from '../types';

export interface CartLine {
  productId: string;
  name: string;
  unitPriceSatang: number;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  add: (p: Product) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (p) =>
        set((s) => {
          const i = s.lines.findIndex((l) => l.productId === p.id);
          if (i >= 0) {
            const lines = [...s.lines];
            lines[i] = { ...lines[i], qty: Math.min(99, lines[i].qty + 1) };
            return { lines };
          }
          return { lines: [...s.lines, { productId: p.id, name: p.name, unitPriceSatang: p.priceSatang, qty: 1 }] };
        }),
      setQty: (productId, qty) =>
        set((s) => ({
          lines: qty <= 0 ? s.lines.filter((l) => l.productId !== productId) : s.lines.map((l) => (l.productId === productId ? { ...l, qty: Math.min(99, qty) } : l)),
        })),
      clear: () => set({ lines: [] }),
    }),
    { name: 'pos-cart' }, // เก็บตะกร้าไว้ กันหายเมื่อรีเฟรช/แอปปิดกะทันหัน
  ),
);

export const cartSubtotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.unitPriceSatang * l.qty, 0);
