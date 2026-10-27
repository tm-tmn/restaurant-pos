import { useQuery } from '@tanstack/react-query';
import { api, NetworkError } from '../lib/api';
import { cachedMenu, cacheMenu } from '../lib/offline';
import type { Menu } from '../types';

/** ดึงเมนูจากเซิร์ฟเวอร์; ถ้าออฟไลน์ใช้เมนูที่แคชไว้ล่าสุด */
export function useMenu() {
  return useQuery({
    queryKey: ['menu'],
    queryFn: async (): Promise<Menu & { fromCache?: boolean }> => {
      try {
        const m = await api<Menu>('/catalog/menu');
        await cacheMenu(m);
        return m;
      } catch (e) {
        if (e instanceof NetworkError) {
          const c = await cachedMenu();
          if (c) return { ...c, fromCache: true };
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}
