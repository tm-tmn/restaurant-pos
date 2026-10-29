import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { runAsSystem, runAsTenant } from '../common/tenant-context';
import { Branch, Tenant, User } from '../entities';
import { JwtPayload } from './auth.guard';
import { LoginThrottle } from './login-throttle';

// hash ปลอมไว้เทียบเวลาเมื่อไม่พบผู้ใช้ — ไม่ให้เดาได้จากเวลาตอบว่าชื่อผู้ใช้มีอยู่จริงหรือไม่
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

@Injectable()
export class AuthService {
  // ต่อชื่อผู้ใช้: ผิด 5 ครั้ง → ล็อกบัญชีนั้น 15 นาที
  private readonly byUser = new LoginThrottle({ maxFails: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 });
  // ต่อ IP: เกณฑ์สูงกว่ามาก เพราะเครื่อง POS ทั้งร้านมักใช้ IP เดียวกัน (กันแค่การไล่เดาหลายบัญชี)
  private readonly byIp = new LoginThrottle({ maxFails: 30, windowMs: 15 * 60_000, lockMs: 15 * 60_000 });

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly jwt: JwtService,
  ) {}

  async login(tenantSlug: string, username: string, password: string, ip: string) {
    const slug = tenantSlug.trim().toLowerCase();
    const userKey = [`u:${slug}/${username.toLowerCase()}`];
    const ipKey = [`ip:${ip}`];
    const wait = Math.max(this.byUser.retryAfter(userKey), this.byIp.retryAfter(ipKey));
    if (wait > 0) {
      throw new HttpException(`ใส่รหัสผิดหลายครั้ง กรุณารอ ${Math.ceil(wait / 60)} นาทีแล้วลองใหม่`, HttpStatus.TOO_MANY_REQUESTS);
    }

    // หาร้านจากรหัสร้าน (ยังไม่รู้ว่าเป็นร้านไหน จึงต้องค้นในโหมด system — อ่านตาราง tenants อย่างเดียว)
    const tenant = await runAsSystem(() => this.tenants.findOneBy({ slug }));

    // ข้อความเดียวกันทุกกรณี ไม่บอกว่ารหัสร้าน ชื่อผู้ใช้ หรือรหัสผ่านผิด
    const bad = new UnauthorizedException('รหัสร้าน ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง');
    const user =
      tenant?.status === 'active'
        ? await runAsTenant(tenant.id, () =>
            this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.username = :username', { username }).getOne(),
          )
        : null;
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!tenant || !user || !user.active || !ok) {
      this.byUser.fail(userKey);
      this.byIp.fail(ipKey);
      throw bad;
    }
    this.byUser.success(userKey);

    const branch = await runAsTenant(tenant.id, () => this.branches.findOneByOrFail({ id: user.branchId }));
    const token = await this.jwt.signAsync({ sub: user.id, tv: user.tokenVersion, tid: tenant.id } satisfies JwtPayload);
    return {
      token,
      tenant: { slug: tenant.slug, name: tenant.name },
      user: { id: user.id, name: user.displayName, role: user.role },
      branch: {
        id: branch.id, code: branch.code, name: branch.name, promptpayId: branch.promptpayId,
        qrOrdering: branch.qrOrdering, qrRequireApproval: branch.qrRequireApproval,
      },
    };
  }
}
