import { BadRequestException, Body, Controller, Patch } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { CurrentUser } from '../auth/auth.guard';
import { AuthUser, Roles } from '../auth/auth.types';
import { Branch } from '../entities';

class UpdateBranchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  /** เบอร์โทร 10 หลัก (ขึ้นต้น 0) หรือเลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก; ส่งสตริงว่างเพื่อล้างค่า */
  @IsOptional() @IsString() promptpayId?: string;
}

@Controller('branches')
export class BranchesController {
  constructor(@InjectRepository(Branch) private readonly branches: Repository<Branch>) {}

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
    const saved = await this.branches.save(b);
    return { id: saved.id, code: saved.code, name: saved.name, promptpayId: saved.promptpayId };
  }
}
