import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { Shift } from '../entities';

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift) private readonly shifts: Repository<Shift>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  findOpen(branchId: string, em?: EntityManager) {
    const repo = em ? em.getRepository(Shift) : this.shifts;
    return repo.findOne({ where: { branchId, closedAt: IsNull() }, order: { openedAt: 'DESC' } });
  }

  /** หากะที่ครอบคลุมเวลา `at` — ใช้ผูกออเดอร์ที่ซิงค์ย้อนหลังจาก offline เข้ากับกะที่ถูกต้อง */
  findForTime(em: EntityManager, branchId: string, at: Date) {
    return em
      .getRepository(Shift)
      .createQueryBuilder('s')
      .where('s.branchId = :branchId', { branchId })
      .andWhere('s.openedAt <= :at', { at })
      .andWhere('(s.closedAt IS NULL OR s.closedAt >= :at)', { at })
      .orderBy('s.openedAt', 'DESC')
      .getOne();
  }

  async current(u: AuthUser) {
    return (await this.findOpen(u.branchId)) ?? null;
  }

  async open(u: AuthUser, openingCashSatang: number) {
    if (await this.findOpen(u.branchId)) throw new ConflictException('มีกะที่เปิดอยู่แล้ว');
    try {
      return await this.shifts.save(this.shifts.create({ branchId: u.branchId, openedBy: u.id, openingCashSatang }));
    } catch (e) {
      // เปิดพร้อมกันจากหลายเครื่อง — unique index กันไว้ที่ฐานข้อมูล
      if ((e as { driverError?: { code?: string } }).driverError?.code === '23505') throw new ConflictException('มีกะที่เปิดอยู่แล้ว');
      throw e;
    }
  }

  async close(u: AuthUser, closingCashSatang: number) {
    return this.ds.transaction(async (em) => {
      const shift = await em
        .getRepository(Shift)
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.branchId = :b AND s.closedAt IS NULL', { b: u.branchId })
        .getOne();
      if (!shift) throw new BadRequestException('ไม่มีกะที่เปิดอยู่');

      const [{ cash }] = await em.query(
        `SELECT COALESCE(SUM(p."amountSatang"), 0)::int AS cash
           FROM payments p JOIN orders o ON o.id = p."orderId"
          WHERE o."shiftId" = $1 AND o.status = 'paid' AND p.method = 'cash'`,
        [shift.id],
      );
      shift.closedAt = new Date();
      shift.closedBy = u.id;
      shift.closingCashSatang = closingCashSatang;
      shift.expectedCashSatang = shift.openingCashSatang + cash;
      return em.save(shift);
    });
  }
}
