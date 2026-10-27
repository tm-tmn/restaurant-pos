import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { Branch, User } from '../entities';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    private readonly jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :username', { username })
      .getOne();

    // ข้อความเดียวกันทุกกรณี ไม่บอกว่าชื่อผู้ใช้หรือรหัสผ่านผิด
    const bad = new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    if (!user || !user.active) throw bad;
    if (!(await bcrypt.compare(password, user.passwordHash))) throw bad;

    const branch = await this.branches.findOneByOrFail({ id: user.branchId });
    const token = await this.jwt.signAsync({
      sub: user.id,
      branchId: user.branchId,
      role: user.role,
      name: user.displayName,
    });
    return {
      token,
      user: { id: user.id, name: user.displayName, role: user.role },
      branch: { id: branch.id, code: branch.code, name: branch.name, promptpayId: branch.promptpayId },
    };
  }
}
