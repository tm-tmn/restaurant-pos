import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { ShiftsService } from './shifts.service';

class OpenShiftDto {
  @IsInt() @Min(0) @Max(100_000_000) openingCashSatang: number;
}
class CloseShiftDto {
  @IsInt() @Min(0) @Max(1_000_000_000) closingCashSatang: number;
}

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get('current')
  current(@CurrentUser() u: AuthUser) {
    return this.shifts.current(u);
  }

  @Post('open')
  open(@CurrentUser() u: AuthUser, @Body() dto: OpenShiftDto) {
    return this.shifts.open(u, dto.openingCashSatang);
  }

  @Post('close')
  close(@CurrentUser() u: AuthUser, @Body() dto: CloseShiftDto) {
    return this.shifts.close(u, dto.closingCashSatang);
  }
}
