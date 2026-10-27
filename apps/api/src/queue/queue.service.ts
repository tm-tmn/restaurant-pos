import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, LessThan } from 'typeorm';
import { DiningTable, newQrToken, QueueStatus, QueueTicket } from '../entities';

/** ตั๋วคิวที่ยังรออยู่ของสาขาหนึ่งมีได้ไม่เกินนี้ (กันสแปมจากหน้าสาธารณะ) */
export const MAX_WAITING = 200;

export function bangkokDay(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
export const ticketCode = (n: number) => `Q${String(n).padStart(3, '0')}`;

export interface NewTicket {
  partySize: number;
  name?: string | null;
  phone?: string | null;
  source: 'staff' | 'customer';
}

@Injectable()
export class QueueService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private view(t: QueueTicket) {
    return {
      id: t.id, code: ticketCode(t.number), number: t.number, partySize: t.partySize, name: t.name, phone: t.phone,
      status: t.status, source: t.source, callCount: t.callCount, tableId: t.tableId, createdAt: t.createdAt, calledAt: t.calledAt,
    };
  }

  async add(branchId: string, input: NewTicket) {
    const day = bangkokDay();
    const t = await this.ds.transaction(async (em) => {
      // เลขคิวรันต่อวันต่อสาขา (atomic เหมือนเลขที่บิล) — ล็อกแถวตัวนับจึงนับ waiting ได้ถูกแม้ยิงพร้อมกัน
      const rows: { n: number }[] = await em.query(
        `INSERT INTO queue_counters ("branchId", day, n) VALUES ($1, $2, 1)
         ON CONFLICT ("branchId", day) DO UPDATE SET n = queue_counters.n + 1 RETURNING n`,
        [branchId, day],
      );
      const waiting = await em.countBy(QueueTicket, { branchId, day, status: In(['waiting', 'called']) });
      if (waiting >= MAX_WAITING) throw new BadRequestException('คิวเต็มในขณะนี้ กรุณาติดต่อพนักงาน');
      return em.save(
        em.create(QueueTicket, {
          branchId, day, number: rows[0].n, partySize: input.partySize, name: input.name || null, phone: input.phone || null,
          token: newQrToken(), status: 'waiting', source: input.source,
        }),
      );
    });
    return { ...this.view(t), token: t.token };
  }

  async list(branchId: string) {
    const rows = await this.ds.getRepository(QueueTicket).find({
      where: { branchId, day: bangkokDay(), status: In(['waiting', 'called']) },
      order: { number: 'ASC' },
    });
    return rows.map((t) => this.view(t));
  }

  /** เรียกคิว (เรียกซ้ำได้ — นับจำนวนครั้งที่เรียก) */
  async call(branchId: string, id: string) {
    return this.transition(branchId, id, ['waiting', 'called'], 'called', (t) => {
      t.calledAt = new Date();
      t.callCount += 1;
    });
  }
  async seat(branchId: string, id: string, tableId?: string) {
    if (tableId && !(await this.ds.getRepository(DiningTable).existsBy({ id: tableId, branchId }))) throw new BadRequestException('ไม่พบโต๊ะ');
    return this.transition(branchId, id, ['waiting', 'called'], 'seated', (t) => {
      t.tableId = tableId ?? null;
      t.closedAt = new Date();
    });
  }
  async cancel(branchId: string, id: string) {
    return this.transition(branchId, id, ['waiting', 'called'], 'cancelled', (t) => (t.closedAt = new Date()));
  }
  async noShow(branchId: string, id: string) {
    return this.transition(branchId, id, ['called', 'waiting'], 'no_show', (t) => (t.closedAt = new Date()));
  }

  private async transition(branchId: string, id: string, from: QueueStatus[], to: QueueStatus, mutate: (t: QueueTicket) => void) {
    return this.ds.transaction(async (em: EntityManager) => {
      const t = await em.findOne(QueueTicket, { where: { id, branchId }, lock: { mode: 'pessimistic_write' } });
      if (!t) throw new NotFoundException('ไม่พบคิว');
      if (!from.includes(t.status)) throw new BadRequestException('คิวนี้ปิดไปแล้ว');
      t.status = to;
      mutate(t);
      return this.view(await em.save(t));
    });
  }

  // ---------- ฝั่งลูกค้า (ไม่ล็อกอิน) ----------

  /** สถานะคิวของตัวเอง: ลำดับที่ (นับเฉพาะคิวที่รออยู่ข้างหน้า) และเลขที่กำลังถูกเรียก */
  async statusByToken(token: string) {
    const t = await this.ds.getRepository(QueueTicket).findOneBy({ token });
    if (!t) throw new NotFoundException('ไม่พบคิว');
    const [ahead, calling] = await Promise.all([
      t.status === 'waiting' || t.status === 'called'
        ? this.ds.getRepository(QueueTicket).countBy({ branchId: t.branchId, day: t.day, status: In(['waiting', 'called']), number: LessThan(t.number) })
        : Promise.resolve(0),
      this.currentlyCalling(t.branchId, t.day),
    ]);
    return { code: ticketCode(t.number), partySize: t.partySize, status: t.status, aheadCount: ahead, calling };
  }

  async cancelByToken(token: string) {
    const t = await this.ds.getRepository(QueueTicket).findOneBy({ token });
    if (!t) throw new NotFoundException('ไม่พบคิว');
    return this.cancel(t.branchId, t.id);
  }

  async currentlyCalling(branchId: string, day = bangkokDay()) {
    const rows = await this.ds.getRepository(QueueTicket).find({
      where: { branchId, day, status: 'called' }, order: { calledAt: 'DESC' }, take: 5,
    });
    return rows.map((t) => ticketCode(t.number));
  }

  /** ข้อมูลจอแสดงคิวหน้าร้าน: เลขที่กำลังเรียก + จำนวนที่รออยู่ (ไม่มีข้อมูลส่วนตัว) */
  async board(branchId: string) {
    const day = bangkokDay();
    const [calling, waiting] = await Promise.all([
      this.currentlyCalling(branchId, day),
      this.ds.getRepository(QueueTicket).countBy({ branchId, day, status: 'waiting' }),
    ]);
    return { calling, waiting };
  }
}
