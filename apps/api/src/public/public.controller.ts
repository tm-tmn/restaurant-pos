import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/auth.types';
import { NewTicketDto } from '../queue/queue.controller';
import { CustomerOrderDto } from './public.dto';
import { PublicService } from './public.service';

const ipOf = (req: Request) => req.ip ?? 'unknown';

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly pub: PublicService) {}

  @Get('t/:token')
  table(@Param('token') token: string, @Req() req: Request) {
    return this.pub.forTable(token, ipOf(req), () => this.pub.tablePage(token, ipOf(req)));
  }

  @Post('t/:token/order')
  @HttpCode(200)
  order(@Param('token') token: string, @Req() req: Request, @Body() dto: CustomerOrderDto) {
    return this.pub.forTable(token, ipOf(req), () => this.pub.submit(token, ipOf(req), dto));
  }

  @Post('t/:token/pay')
  @HttpCode(200)
  pay(@Param('token') token: string, @Req() req: Request) {
    return this.pub.forTable(token, ipOf(req), () => this.pub.startPayment(token, ipOf(req)));
  }

  @Get('t/:token/pay/:intentId')
  payStatus(@Param('token') token: string, @Param('intentId') intentId: string, @Req() req: Request) {
    return this.pub.forTable(token, ipOf(req), () => this.pub.paymentStatus(token, ipOf(req), intentId));
  }

  // ---- คิว (ต้องอยู่ก่อน :shop/:branchCode) ----
  @Get('queue/ticket/:token')
  ticket(@Param('token') token: string, @Req() req: Request) {
    return this.pub.forQueueTicket(token, ipOf(req), () => this.pub.queueStatus(token, ipOf(req)));
  }

  @Post('queue/ticket/:token/cancel')
  @HttpCode(200)
  cancelTicket(@Param('token') token: string, @Req() req: Request) {
    return this.pub.forQueueTicket(token, ipOf(req), () => this.pub.cancelQueue(token, ipOf(req)));
  }

  @Get('queue/:shop/:branchCode/board')
  board(@Param('shop') shop: string, @Param('branchCode') code: string, @Req() req: Request) {
    return this.pub.forShop(shop, ipOf(req), () => this.pub.queueBoard(code, ipOf(req)));
  }

  @Post('queue/:shop/:branchCode')
  @HttpCode(200)
  join(@Param('shop') shop: string, @Param('branchCode') code: string, @Req() req: Request, @Body() dto: NewTicketDto) {
    return this.pub.forShop(shop, ipOf(req), () => this.pub.joinQueue(code, ipOf(req), dto));
  }
}
