import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { Role, User } from '../entities';

class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9._-]{3,32}$/, { message: 'username ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3-32 ตัว' }) username: string;
  @IsString() @MinLength(8, { message: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' }) password: string;
  @IsString() @MinLength(1) displayName: string;
  @IsIn(['manager', 'cashier']) role: Role;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) displayName?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Roles('manager')
@Controller('users')
export class UsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.users.find({ where: { branchId: u.branchId }, order: { username: 'ASC' } });
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    // manager สร้างได้เฉพาะ cashier; manager ใหม่ต้องให้ owner สร้าง
    if (u.role !== 'owner' && dto.role !== 'cashier') throw new ForbiddenException('สร้างได้เฉพาะพนักงานแคชเชียร์');
    if (await this.users.existsBy({ username: dto.username })) throw new BadRequestException('มี username นี้แล้ว');
    const saved = await this.users.save(
      this.users.create({
        branchId: u.branchId,
        username: dto.username,
        displayName: dto.displayName,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
      }),
    );
    return { id: saved.id, username: saved.username, displayName: saved.displayName, role: saved.role, active: saved.active };
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    const target = await this.users.findOneBy({ id, branchId: u.branchId });
    if (!target) throw new NotFoundException();
    if (target.role === 'owner' && u.role !== 'owner') throw new ForbiddenException();
    if (target.role === 'manager' && u.role !== 'owner' && target.id !== u.id) throw new ForbiddenException();
    if (dto.active === false && target.id === u.id) throw new BadRequestException('ปิดใช้งานบัญชีตัวเองไม่ได้');
    if (dto.displayName !== undefined) target.displayName = dto.displayName;
    if (dto.active !== undefined) target.active = dto.active;
    if (dto.password) target.passwordHash = await bcrypt.hash(dto.password, 10);
    const saved = await this.users.save(target);
    return { id: saved.id, username: saved.username, displayName: saved.displayName, role: saved.role, active: saved.active };
  }
}
