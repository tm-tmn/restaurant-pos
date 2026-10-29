/** origin ของหน้าเว็บที่อนุญาต (CORS_ORIGINS คั่นด้วย comma) — ใช้ทั้ง REST และ WebSocket */
export const corsOrigins = (): string[] =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
