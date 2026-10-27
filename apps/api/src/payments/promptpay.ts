/**
 * Thai QR Payment (PromptPay, EMVCo merchant-presented) — ฝั่งเซิร์ฟเวอร์
 * ใช้ตรรกะเดียวกับ apps/web/src/lib/promptpay.ts (ทดสอบด้วยเวกเตอร์ชุดเดียวกัน)
 * เซิร์ฟเวอร์สร้าง payload เองเพื่อให้ยอดใน QR ตรงกับ payment intent เสมอ
 */
function tlv(tag: string, value: string): string {
  return tag + String(value.length).padStart(2, '0') + value;
}

export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export class PromptPayError extends Error {}

export function promptPayPayload(id: string, amountSatang: number): string {
  const target = id.replace(/[\s-]/g, '');
  let accountTag: string;
  let account: string;
  if (/^0\d{9}$/.test(target)) {
    accountTag = '01';
    account = '0066' + target.slice(1);
  } else if (/^\d{13}$/.test(target)) {
    accountTag = '02';
    account = target;
  } else {
    throw new PromptPayError('PromptPay ID ต้องเป็นเบอร์โทร 10 หลัก (ขึ้นต้น 0) หรือเลข 13 หลัก');
  }
  if (!Number.isInteger(amountSatang) || amountSatang <= 0) throw new PromptPayError('ยอดเงินต้องเป็นจำนวนเต็มสตางค์ที่มากกว่า 0');
  const body =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('29', tlv('00', 'A000000677010111') + tlv(accountTag, account)) +
    tlv('53', '764') +
    tlv('54', (amountSatang / 100).toFixed(2)) +
    tlv('58', 'TH') +
    '6304';
  return body + crc16(body);
}
