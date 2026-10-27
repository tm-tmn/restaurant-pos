import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { DiningTable, newQrToken, Order } from '../entities';

class TableDto {
  @IsString() @MinLength(1) @MaxLength(20) name: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) seats?: number;
}
class UpdateTableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20) name?: string;
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
      const { qrToken: _omit, ...rest } = t; // โทเค็น QR ไม่ส่งให้พนักงานทั่วไป — ผู้จัดการดูได้จาก /tables/qr
      return { ...rest, openOrder: o ? { id: o.id, orderNo: o.orderNo, totalSatang: o.totalSatang } : null };
    });
  }

  /** โทเค็นใน QR ประจำโต๊ะ (สำหรับพิมพ์ QR) */
  @Roles('manager')
  @Get('qr')
  async qr(@CurrentUser() u: AuthUser) {
    const rows = await this.tables.find({ where: { branchId: u.branchId, active: true }, order: { name: 'ASC' } });
    return rows.map((t) => ({ id: t.id, name: t.name, qrToken: t.qrToken }));
  }

  /** QR หลุดไปนอกร้าน/ถูกแอบถ่าย → หมุนโทเค็นใหม่ QR เดิมใช้ไม่ได้ทันที */
  @Roles('manager')
  @Post(':id/rotate-qr')
  async rotate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.tables.findOneBy({ id, branchId: u.branchId });
    if (!t) throw new NotFoundException();
    t.qrToken = newQrToken();
    await this.tables.save(t);
    return { id: t.id, name: t.name, qrToken: t.qrToken };
  }

  @Roles('manager')
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: TableDto) {
    const t = await this.tables.save(this.tables.create({ ...dto, branchId: u.branchId }));
    const { qrToken: _omit, ...rest } = t;
    return rest;
  }

  @Roles('manager')
  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    const t = await this.tables.findOneBy({ id, branchId: u.branchId });
    if (!t) throw new NotFoundException();
    if (dto.active === false && (await this.orders.existsBy({ tableId: id, status: 'open' }))) {
      throw new BadRequestException('โต๊ะนี้มีบิลเปิดอยู่ — ชำระหรือยกเลิกบิลก่อนปิดใช้งาน');
    }
    const saved = await this.tables.save(Object.assign(t, dto));
    const { qrToken: _omit, ...rest } = saved;
    return rest;
  }
}
