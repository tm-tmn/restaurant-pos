import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { AddItemsDto, CreateOrderDto, PayOrderDto, SyncBatchDto, VoidDto } from './orders.dto';
import { OrdersService } from './orders.service';

class ListQuery {
  @IsOptional() @IsIn(['open', 'paid', 'void']) status?: 'open' | 'paid' | 'void';
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.orders.list(u, q.status ?? 'open');
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(u, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(u, dto);
  }

  @Post(':id/items')
  addItems(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddItemsDto) {
    return this.orders.addItems(u, id, dto);
  }

  @Post(':id/pay')
  @HttpCode(200)
  pay(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayOrderDto) {
    // ส่วนลดต้องให้ผู้จัดการขึ้นไปเป็นผู้อนุมัติ
    if ((dto.discountSatang ?? 0) > 0 && u.role === 'cashier') throw new ForbiddenException('ส่วนลดต้องให้ผู้จัดการดำเนินการ');
    return this.orders.pay(u, id, dto);
  }

  @Roles('manager')
  @Post(':id/void')
  @HttpCode(200)
  voidOrder(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidDto) {
    return this.orders.voidOrder(u, id, dto.reason);
  }

  @Roles('manager')
  @Post(':id/items/:itemId/void')
  @HttpCode(200)
  voidItem(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: VoidDto,
  ) {
    return this.orders.voidItem(u, id, itemId, dto.reason);
  }
}

@Controller('sync')
export class SyncController {
  constructor(private readonly orders: OrdersService) {}

  @Post('orders')
  @HttpCode(200)
  async syncOrders(@CurrentUser() u: AuthUser, @Body() dto: SyncBatchDto) {
    return { results: await this.orders.sync(u, dto.orders) };
  }
}
