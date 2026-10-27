import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import type { PendingGroup } from '../types';
import { useBeep } from './useBeep';

/** รายการที่ลูกค้าสั่งผ่าน QR และรอพนักงานยืนยัน — โพลทุก 5 วินาที เตือนด้วยเสียงเมื่อมีเพิ่ม */
export function usePending(enabled = true) {
  const beep = useBeep();
  const q = useQuery({
    queryKey: ['pending'],
    queryFn: () => api<PendingGroup[]>('/orders/pending'),
    refetchInterval: 5_000,
    enabled,
  });
  const count = q.data?.reduce((s, g) => s + g.items.length, 0) ?? 0;
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (prev.current !== null && count > prev.current) beep();
    prev.current = count;
  }, [count, beep]);
  return { ...q, count };
}
