import { useEffect, useRef } from 'react';

/**
 * ตรวจจับการยิงบาร์โค้ดจากเครื่องสแกนแบบ USB/Bluetooth (ทำงานเหมือนคีย์บอร์ด: พิมพ์เร็วมากแล้วกด Enter)
 * - แยกจากการพิมพ์ของคนด้วยความเร็ว (< 50ms ต่อตัวอักษร)
 * - ไม่ดักเมื่อผู้ใช้กำลังพิมพ์ในช่อง input/textarea (ยกเว้นช่องที่มี data-scan-target)
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buf = useRef('');
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && !el.hasAttribute('data-scan-target');
      if (typing) return;

      const now = performance.now();
      if (now - last.current > 50) buf.current = '';
      last.current = now;

      if (e.key === 'Enter') {
        if (buf.current.length >= 4) {
          e.preventDefault();
          cb.current(buf.current);
        }
        buf.current = '';
      } else if (e.key.length === 1) {
        buf.current += e.key;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
