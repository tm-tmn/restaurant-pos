import { BadRequestException, Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { Branch } from '../entities';

class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  /** เบอร์โทร 10 หลัก (ขึ้นต้น 0) หรือเลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก; ส่งสตริงว่างเพื่อล้างค่า */
  @IsOptional() @IsString() promptpayId?: string;
  @IsOptional() @IsBoolean() qrOrdering?: boolean;
  @IsOptional() @IsBoolean() qrRequireApproval?: boolean;
}
class CreateBranchDto {
  @IsString() @Matches(/^[A-Z0-9]{2,10}$/, { message: 'รหัสสาขาใช้ A-Z, 0-9 ยาว 2-10 ตัว' }) code: string;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
}

const view = (b: Branch) => ({
  id: b.id, code: b.code, name: b.name, promptpayId: b.promptpayId, qrOrdering: b.qrOrdering, qrRequireApproval: b.qrRequireApproval,
});

@Controller('branches')
export class BranchesController {
  constructor(@InjectRepository(Branch) private readonly branches: Repository<Branch>) {}

  /** รายชื่อสาขา (ใช้เลือกปลายทางการโอนสต็อก) */
  @Roles('manager')
  @Get()
  async list() {
    return (await this.branches.find({ order: { code: 'ASC' } })).map((b) => ({ id: b.id, code: b.code, name: b.name }));
  }

  @Roles('owner')
  @Post()
  async create(@Body() dto: CreateBranchDto) {
    if (await this.branches.existsBy({ code: dto.code })) throw new BadRequestException('มีรหัสสาขานี้แล้ว');
    return view(await this.branches.save(this.branches.create({ code: dto.code, name: dto.name, promptpayId: null, qrOrdering: true, qrRequireApproval: true })));
  }

  @Roles('manager')
  @Patch('me')
  async updateMine(@CurrentUser() u: AuthUser, @Body() dto: UpdateBranchDto) {
    const b = await this.branches.findOneByOrFail({ id: u.branchId });
    if (dto.name !== undefined) b.name = dto.name;
    if (dto.promptpayId !== undefined) {
      const id = dto.promptpayId.replace(/[\s-]/g, '');
      if (id !== '' && !/^0\d{9}$/.test(id) && !/^\d{13}$/.test(id)) {
        throw new BadRequestException('PromptPay ID ต้องเป็นเบอร์โทร 10 หลัก (ขึ้นต้น 0) หรือเลข 13 หลัก');
      }
      b.promptpayId = id === '' ? null : id;
    }
    if (dto.qrOrdering !== undefined) b.qrOrdering = dto.qrOrdering;
    if (dto.qrRequireApproval !== undefined) b.qrRequireApproval = dto.qrRequireApproval;
    return view(await this.branches.save(b));
  }
}
