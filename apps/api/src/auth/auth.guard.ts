import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role, User } from '../entities';
import { AuthUser, IS_PUBLIC, ROLES } from './auth.types';

export interface JwtPayload {
  sub: string;
  /** tokenVersion ตอนออกโทเค็น */
  tv: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('ต้องเข้าสู่ระบบ');

    let p: JwtPayload;
    try {
      p = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('โทเค็นไม่ถูกต้องหรือหมดอายุ');
    }

    // อ่านสถานะผู้ใช้จริงทุกครั้ง: ปิดใช้งาน/เปลี่ยนรหัสผ่าน/เปลี่ยนสิทธิ์ มีผลทันที ไม่ต้องรอโทเค็นหมดอายุ
    const user = await this.users.findOne({
      where: { id: p.sub },
      select: { id: true, branchId: true, role: true, displayName: true, active: true, tokenVersion: true },
    });
    if (!user || !user.active || user.tokenVersion !== p.tv) {
      throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    req.user = { id: user.id, branchId: user.branchId, role: user.role, name: user.displayName } satisfies AuthUser;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && user.role !== 'owner' && !roles.includes(user.role)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
