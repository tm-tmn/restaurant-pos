import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { AddItemsDto, CreateOrderDto, PayOrderDto, SyncBatchDto, VoidDto } from './orders.dto';
import { OrdersService } from './orders.service';

class ListQuery {
  @IsOptional() @IsIn(['open', 'paid', 'void']) status?: 'open' | 'paid' | 'void';
}

class PendingActionDto {
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) itemIds?: string[];
}
class RejectPendingDto extends PendingActionDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.orders.list(u, q.status ?? 'open');
  }

  /** รายการที่ลูกค้าสั่งผ่าน QR และรอพนักงานยืนยัน (ต้องอยู่ก่อน :id) */
  @Get('pending')
  pending(@CurrentUser() u: AuthUser) {
    return this.orders.listPending(u);
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

  @Post(':id/pending/approve')
  @HttpCode(200)
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PendingActionDto) {
    return this.orders.approvePending(u, id, dto.itemIds);
  }

  @Post(':id/pending/reject')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPendingDto) {
    return this.orders.rejectPending(u, id, dto.reason?.trim() || 'ไม่ระบุเหตุผล', dto.itemIds);
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
