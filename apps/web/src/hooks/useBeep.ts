import { useCallback, useRef } from 'react';

/** เสียงเตือนสั้นๆ (WebAudio) — เบราว์เซอร์ต้องมีการแตะหน้าจอมาก่อนถึงจะเล่นเสียงได้ ถ้าเล่นไม่ได้ก็ข้ามเงียบๆ */
export function useBeep() {
  const ctx = useRef<AudioContext | null>(null);
  return useCallback(() => {
    try {
      ctx.current ??= new AudioContext();
      const c = ctx.current;
      if (c.state === 'suspended') void c.resume();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.5);
    } catch {
      /* ไม่มีเสียงก็ไม่เป็นไร */
    }
  }, []);
}
