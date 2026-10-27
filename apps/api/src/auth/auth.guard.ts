import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser, IS_PUBLIC, ROLES } from './auth.types';
import { Role } from '../entities';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('ต้องเข้าสู่ระบบ');

    try {
      const p = await this.jwt.verifyAsync<{ sub: string; branchId: string; role: Role; name: string }>(token);
      req.user = { id: p.sub, branchId: p.branchId, role: p.role, name: p.name } satisfies AuthUser;
    } catch {
      throw new UnauthorizedException('โทเค็นไม่ถูกต้องหรือหมดอายุ');
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && req.user.role !== 'owner' && !roles.includes(req.user.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
