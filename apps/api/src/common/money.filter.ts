import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { MoneyError } from './money';

/** แปลงความผิดพลาดของตรรกะเงินเป็น HTTP 400 พร้อมข้อความที่อ่านรู้เรื่อง */
@Catch(MoneyError)
export class MoneyErrorFilter implements ExceptionFilter {
  catch(err: MoneyError, host: ArgumentsHost) {
    const http: HttpException = new BadRequestException(err.message);
    const res = host.switchToHttp().getResponse();
    res.status(http.getStatus()).json(http.getResponse());
  }
}
