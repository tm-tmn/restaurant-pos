import { createHmac, timingSafeEqual } from 'node:crypto';

/** ยอมให้เวลาในคำขอคลาดเคลื่อนได้ไม่เกินนี้ (กันการส่ง webhook เก่ามาซ้ำ) */
export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

/** ลายเซ็น = HMAC-SHA256(secret, `${timestampMs}.${rawBody}`) เป็น hex */
export function signWebhook(secret: string, timestampMs: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampMs}.${rawBody}`).digest('hex');
}

export function verifyWebhook(secret: string, timestampHeader: string | undefined, signature: string | undefined, rawBody: string, now = Date.now()): boolean {
  if (!secret || !timestampHeader || !signature || !/^\d{10,16}$/.test(timestampHeader)) return false;
  const ts = Number(timestampHeader);
  if (Math.abs(now - ts) > WEBHOOK_TOLERANCE_MS) return false;
  const expected = Buffer.from(signWebhook(secret, ts, rawBody), 'hex');
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
