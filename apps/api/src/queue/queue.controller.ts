import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { QueueService } from './queue.service';

export class NewTicketDto {
  @IsInt() @Min(1) @Max(30) partySize: number;
  @IsOptional() @IsString() @MaxLength(50) name?: string;
  @IsOptional() @Matches(/^[0-9+\-\s]{6,20}$/, { message: 'เบอร์โทรไม่ถูกต้อง' }) phone?: string;
}
class SeatDto {
  @IsOptional() @IsUUID() tableId?: string;
}

/** จัดการคิวโดยพนักงาน */
@Controller('queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.queue.list(u.branchId);
  }

  @Post()
  add(@CurrentUser() u: AuthUser, @Body() dto: NewTicketDto) {
    return this.queue.add(u.branchId, { ...dto, source: 'staff' });
  }

  @Post(':id/call')
  @HttpCode(200)
  call(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queue.call(u.branchId, id);
  }

  @Post(':id/seat')
  @HttpCode(200)
  seat(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SeatDto) {
    return this.queue.seat(u.branchId, id, dto.tableId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queue.cancel(u.branchId, id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queue.noShow(u.branchId, id);
  }
}
