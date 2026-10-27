import { SetMetadata } from '@nestjs/common';
import { Role } from '../entities';

export interface AuthUser {
  id: string;
  branchId: string;
  role: Role;
  name: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** จำกัดสิทธิ์ตาม role; owner ผ่านได้ทุกที่เสมอ */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
