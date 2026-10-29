import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useLiveInterval } from '../lib/live';
import type { PendingGroup } from '../types';
import { useBeep } from './useBeep';

/** รายการที่ลูกค้าสั่งผ่าน QR และรอพนักงานยืนยัน — อัปเดตทันทีผ่าน real-time (สำรองด้วยการโหลดเป็นระยะ) เตือนด้วยเสียงเมื่อมีเพิ่ม */
export function usePending(enabled = true) {
  const beep = useBeep();
  const every = useLiveInterval(5_000, 30_000);
  const q = useQuery({
    queryKey: ['pending'],
    queryFn: () => api<PendingGroup[]>('/orders/pending'),
    refetchInterval: every,
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
