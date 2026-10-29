import { Body, Controller, Get, Ip, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Branch, Tenant } from '../entities';
import { CurrentUser } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthUser, Public } from './auth.types';

class LoginDto {
  /** รหัสร้าน (slug) */
  @IsString() @MinLength(1) @MaxLength(40) tenant: string;
  @IsString() @MinLength(1) @MaxLength(64) username: string;
  @IsString() @MinLength(1) @MaxLength(128) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.tenant, dto.username, dto.password, ip);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const [branch, tenant] = await Promise.all([
      this.branches.findOneByOrFail({ id: u.branchId }),
      this.tenants.findOneByOrFail({ id: u.tenantId }),
    ]);
    return {
      tenant: { slug: tenant.slug, name: tenant.name },
      user: { id: u.id, name: u.name, role: u.role },
      branch: {
        id: branch.id, code: branch.code, name: branch.name, promptpayId: branch.promptpayId,
        qrOrdering: branch.qrOrdering, qrRequireApproval: branch.qrRequireApproval,
      },
    };
  }
}
