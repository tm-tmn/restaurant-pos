import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/** ชื่อคอลัมน์ → คำที่ผู้ใช้เข้าใจ (ใช้กับข้อความ "ข้อมูลซ้ำ") */
const COLUMN_TH: Record<string, string> = {
  barcode: 'บาร์โค้ด',
  sku: 'SKU',
  name: 'ชื่อ',
  username: 'ชื่อผู้ใช้',
  code: 'รหัส',
};

/**
 * แปลง error จาก PostgreSQL ที่เกิดจากข้อมูลของผู้ใช้ ให้เป็น 4xx พร้อมข้อความภาษาไทย
 * แทนที่จะตอบ 500 — error ประเภทอื่นยังคงเป็น 500 และถูก log ตามปกติ
 */
@Catch(QueryFailedError)
export class DbErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('DbError');

  catch(err: QueryFailedError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const d = err.driverError as { code?: string; detail?: string; constraint?: string } | undefined;
    const send = (status: number, message: string) => res.status(status).json({ statusCode: status, message });

    switch (d?.code) {
      case '23505': {
        // detail: Key (barcode)=(885...) already exists.  /  Key ("branchId", name)=(…, T1) already exists.
        const cols = d.detail?.match(/^Key \((.+?)\)=/)?.[1]?.replace(/"/g, '').split(',').map((s) => s.trim()) ?? [];
        const col = cols.find((c) => COLUMN_TH[c]);
        return send(HttpStatus.CONFLICT, col ? `${COLUMN_TH[col]}นี้มีอยู่แล้ว` : 'ข้อมูลซ้ำกับที่มีอยู่แล้ว');
      }
      case '23503':
        return send(HttpStatus.BAD_REQUEST, 'ข้อมูลอ้างอิงไม่ถูกต้อง (ไม่พบรายการที่เลือก)');
      case '22003':
        return send(HttpStatus.BAD_REQUEST, 'ตัวเลขมากเกินกว่าที่ระบบรองรับ');
      case '22P02':
      case '22007':
      case '22008':
        return send(HttpStatus.BAD_REQUEST, 'รูปแบบข้อมูลไม่ถูกต้อง');
      case '40P01':
      case '40001':
        return send(HttpStatus.CONFLICT, 'มีการแก้ไขข้อมูลพร้อมกัน กรุณาลองใหม่');
      default:
        this.log.error(err.message, err.stack);
        return send(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
    }
  }
}
