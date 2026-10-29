import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { runAsTenant } from '../common/tenant-context';
import { Role } from '../entities';
import { AuthUser, IS_PUBLIC, ROLES } from './auth.types';

export interface JwtPayload {
  sub: string;
  /** tokenVersion ตอนออกโทเค็น */
  tv: number;
  /** ร้านของผู้ใช้ — ทุกคำสั่ง SQL ของคำขอนี้จะรันในนามร้านนี้ (RLS) */
  tid: string;
}

interface UserRow {
  id: string;
  tenantId: string;
  branchId: string;
  role: Role;
  displayName: string;
  active: boolean;
  tokenVersion: number;
  tenantStatus: string;
}

/** ตรวจโทเค็น + สถานะผู้ใช้/ร้านล่าสุด — ใช้ทั้ง HTTP และ WebSocket */
export async function resolveUser(jwt: JwtService, ds: DataSource, token: string | undefined): Promise<AuthUser> {
  if (!token) throw new UnauthorizedException('ต้องเข้าสู่ระบบ');
  let p: JwtPayload;
  try {
    p = await jwt.verifyAsync<JwtPayload>(token);
  } catch {
    throw new UnauthorizedException('โทเค็นไม่ถูกต้องหรือหมดอายุ');
  }
  // โทเค็นรุ่นก่อนรองรับหลายร้านไม่มี tid → ให้ล็อกอินใหม่
  if (typeof p.tid !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.tid)) throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  // อ่านสถานะผู้ใช้จริงทุกครั้ง: ปิดใช้งาน/เปลี่ยนรหัสผ่าน/เปลี่ยนสิทธิ์/ระงับร้าน มีผลทันที ไม่ต้องรอโทเค็นหมดอายุ
  const rows: UserRow[] = await runAsTenant(p.tid, () =>
    ds.query(
      `SELECT u.id, u."tenantId", u."branchId", u.role, u."displayName", u.active, u."tokenVersion", t.status AS "tenantStatus"
         FROM users u JOIN tenants t ON t.id = u."tenantId" WHERE u.id = $1`,
      [p.sub],
    ),
  );
  const user = rows[0];
  if (!user || !user.active || user.tokenVersion !== p.tv || user.tenantStatus !== 'active') {
    throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  return { id: user.id, tenantId: user.tenantId, branchId: user.branchId, role: user.role, name: user.displayName };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const user = await resolveUser(this.jwt, this.ds, header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    req.user = user;

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
