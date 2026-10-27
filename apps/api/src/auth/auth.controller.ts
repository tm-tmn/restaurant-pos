import { Body, Controller, Get, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsString, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { Branch } from '../entities';
import { CurrentUser } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthUser, Public } from './auth.types';

class LoginDto {
  @IsString() @MinLength(1) username: string;
  @IsString() @MinLength(1) password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
  ) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const branch = await this.branches.findOneByOrFail({ id: u.branchId });
    return {
      user: { id: u.id, name: u.name, role: u.role },
      branch: { id: branch.id, code: branch.code, name: branch.name, promptpayId: branch.promptpayId },
    };
  }
}
