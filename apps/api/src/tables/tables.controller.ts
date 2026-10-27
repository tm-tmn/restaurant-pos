import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { DiningTable, Order } from '../entities';

class TableDto {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) seats?: number;
}
class UpdateTableDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) seats?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('tables')
export class TablesController {
  constructor(
    @InjectRepository(DiningTable) private readonly tables: Repository<DiningTable>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  /** รายการโต๊ะพร้อมบิลที่ยังเปิดอยู่ (ถ้ามี) */
  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const [tables, open] = await Promise.all([
      this.tables.find({ where: { branchId: u.branchId, active: true }, order: { name: 'ASC' } }),
      this.orders.find({ where: { branchId: u.branchId, status: 'open' } }),
    ]);
    const byTable = new Map(open.filter((o) => o.tableId).map((o) => [o.tableId, o]));
    return tables.map((t) => {
      const o = byTable.get(t.id);
      return { ...t, openOrder: o ? { id: o.id, orderNo: o.orderNo, totalSatang: o.totalSatang } : null };
    });
  }

  @Roles('manager')
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: TableDto) {
    return this.tables.save(this.tables.create({ ...dto, branchId: u.branchId }));
  }

  @Roles('manager')
  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    const t = await this.tables.findOneBy({ id, branchId: u.branchId });
    if (!t) throw new NotFoundException();
    return this.tables.save(Object.assign(t, dto));
  }
}
