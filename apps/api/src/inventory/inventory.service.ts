import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser } from '../auth/auth.types';
import { AuditLog, Branch, Ingredient, MovementType, Product, RecipeItem, StockCount, StockLevel, StockMovement } from '../entities';
import { adjustTo, avgCost, consume, explodeBom, Level, receive, recipeCost, StockError } from './costing';

interface MoveMeta {
  reason?: string | null;
  refType?: StockMovement['refType'];
  refId?: string | null;
  expiryDate?: string | null;
  supplier?: string | null;
  userId?: string | null;
}

@Injectable()
export class InventoryService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ================= core =================

  /**
   * ล็อกแถวคงเหลือของวัตถุดิบหลายตัวพร้อมกัน (สร้างแถวถ้ายังไม่มี)
   * ล็อกตามลำดับ ingredientId เสมอ เพื่อกัน deadlock เมื่อหลายทรานแซกชันแตะวัตถุดิบชุดเดียวกัน
   */
  private async lockLevels(em: EntityManager, branchId: string, ingredientIds: string[]) {
    const ids = [...new Set(ingredientIds)].sort();
    if (ids.length === 0) return new Map<string, StockLevel>();
    await em
      .createQueryBuilder()
      .insert()
      .into(StockLevel)
      .values(ids.map((ingredientId) => ({ branchId, ingredientId, qty: 0, valueSatang: 0 })))
      .orIgnore()
      .execute();
    const rows = await em
      .getRepository(StockLevel)
      .createQueryBuilder('l')
      .setLock('pessimistic_write')
      .where('l.branchId = :branchId AND l.ingredientId IN (:...ids)', { branchId, ids })
      .orderBy('l.ingredientId')
      .getMany();
    return new Map(rows.map((r) => [r.ingredientId, r]));
  }

  private async record(em: EntityManager, lvl: StockLevel, next: Level, type: MovementType, qtyDelta: number, valueDelta: number, meta: MoveMeta) {
    lvl.qty = next.qty;
    lvl.valueSatang = next.valueSatang;
    await em.save(lvl);
    await em.save(
      em.create(StockMovement, {
        branchId: lvl.branchId,
        ingredientId: lvl.ingredientId,
        type,
        qtyDelta,
        valueDeltaSatang: valueDelta,
        balanceQty: next.qty,
        reason: meta.reason ?? null,
        refType: meta.refType ?? null,
        refId: meta.refId ?? null,
        expiryDate: meta.expiryDate ?? null,
        supplier: meta.supplier ?? null,
        userId: meta.userId ?? null,
      }),
    );
  }

  private async assertIngredients(em: EntityManager, ids: string[]) {
    const uniq = [...new Set(ids)];
    const found = await em.count(Ingredient, { where: { id: In(uniq), active: true } });
    if (found !== uniq.length) throw new BadRequestException('มีวัตถุดิบที่ไม่พบหรือปิดใช้งานแล้ว');
  }

  private wrap<T>(fn: () => Promise<T>): Promise<T> {
    return fn().catch((e) => {
      if (e instanceof StockError) throw new BadRequestException(e.message);
      throw e;
    });
  }

  /**
   * หักวัตถุดิบตามสูตรเมื่อบิลถูกชำระ — เรียกจาก OrdersService ภายในทรานแซกชันเดียวกับการชำระ
   * ยอมให้สต็อกติดลบได้ (ไม่บล็อกการขาย) คืนค่าต้นทุนขาย (COGS) ของบิล
   */
  async deductForSale(em: EntityManager, branchId: string, orderId: string, items: { productId: string | null; qty: number }[]) {
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => !!x))];
    if (productIds.length === 0) return 0;
    const lines = await em.find(RecipeItem, { where: { productId: In(productIds) } });
    if (lines.length === 0) return 0;
    const recipes = new Map<string, { ingredientId: string; qty: number }[]>();
    for (const l of lines) recipes.set(l.productId, [...(recipes.get(l.productId) ?? []), l]);
    const need = explodeBom(items, recipes);
    const levels = await this.lockLevels(em, branchId, [...need.keys()]);

    let cogs = 0;
    for (const [ingredientId, qty] of [...need.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (qty <= 0) continue;
      const lvl = levels.get(ingredientId)!;
      const r = consume(lvl, qty, true);
      cogs -= r.valueDelta;
      await this.record(em, lvl, r.next, 'sale', -qty, r.valueDelta, { refType: 'order', refId: orderId });
    }
    return cogs;
  }

  // ================= stock operations =================

  receive(u: AuthUser, dto: { supplier?: string; note?: string; items: { ingredientId: string; qty: number; totalCostSatang: number; expiryDate?: string }[] }) {
    return this.wrap(() =>
      this.ds.transaction(async (em) => {
        await this.assertIngredients(em, dto.items.map((i) => i.ingredientId));
        const levels = await this.lockLevels(em, u.branchId, dto.items.map((i) => i.ingredientId));
        for (const it of dto.items) {
          const lvl = levels.get(it.ingredientId)!;
          const r = receive(lvl, it.qty, it.totalCostSatang);
          await this.record(em, lvl, r.next, 'receive', it.qty, r.valueDelta, {
            reason: dto.note ?? null,
            supplier: dto.supplier ?? null,
            expiryDate: it.expiryDate ?? null,
            userId: u.id,
          });
        }
        return { ok: true, count: dto.items.length };
      }),
    );
  }

  /** เบิกใช้ (issue) หรือ ของเสีย (waste) — ไม่อนุญาตให้ติดลบ */
  consume(u: AuthUser, type: 'issue' | 'waste', dto: { reason: string; items: { ingredientId: string; qty: number }[] }) {
    return this.wrap(() =>
      this.ds.transaction(async (em) => {
        await this.assertIngredients(em, dto.items.map((i) => i.ingredientId));
        const levels = await this.lockLevels(em, u.branchId, dto.items.map((i) => i.ingredientId));
        let value = 0;
        for (const it of this.mergeItems(dto.items)) {
          const lvl = levels.get(it.ingredientId)!;
          const r = consume(lvl, it.qty, false);
          value -= r.valueDelta;
          await this.record(em, lvl, r.next, type, -it.qty, r.valueDelta, { reason: dto.reason, userId: u.id });
        }
        if (type === 'waste') {
          await em.save(
            em.create(AuditLog, {
              branchId: u.branchId,
              userId: u.id,
              action: 'stock.waste',
              entity: 'stock',
              entityId: null,
              detail: { reason: dto.reason, valueSatang: value, items: dto.items },
            }),
          );
        }
        return { ok: true, valueSatang: value };
      }),
    );
  }

  /** โอนระหว่างสาขา: ตัดออกที่ต้นทางตามต้นทุนเฉลี่ย แล้วรับเข้าปลายทางด้วยมูลค่าเดียวกัน */
  transfer(u: AuthUser, dto: { toBranchId: string; note?: string; items: { ingredientId: string; qty: number }[] }) {
    if (dto.toBranchId === u.branchId) throw new BadRequestException('สาขาปลายทางต้องไม่ใช่สาขาเดียวกัน');
    return this.wrap(() =>
      this.ds.transaction(async (em) => {
        const to = await em.findOneBy(Branch, { id: dto.toBranchId });
        if (!to) throw new NotFoundException('ไม่พบสาขาปลายทาง');
        await this.assertIngredients(em, dto.items.map((i) => i.ingredientId));
        const items = this.mergeItems(dto.items);
        const ids = items.map((i) => i.ingredientId);
        // ล็อกสาขาตามลำดับ branchId เพื่อกัน deadlock กรณีโอนสวนทางกันพร้อมกัน
        const [first, second] = [u.branchId, to.id].sort();
        const lockedA = await this.lockLevels(em, first, ids);
        const lockedB = await this.lockLevels(em, second, ids);
        const src = first === u.branchId ? lockedA : lockedB;
        const dst = first === u.branchId ? lockedB : lockedA;

        const transferId = randomUUID();
        for (const it of items) {
          const out = consume(src.get(it.ingredientId)!, it.qty, false);
          await this.record(em, src.get(it.ingredientId)!, out.next, 'transfer_out', -it.qty, out.valueDelta, {
            reason: dto.note ?? `โอนไป ${to.name}`,
            refType: 'transfer',
            refId: transferId,
            userId: u.id,
          });
          const inn = receive(dst.get(it.ingredientId)!, it.qty, -out.valueDelta);
          await this.record(em, dst.get(it.ingredientId)!, inn.next, 'transfer_in', it.qty, inn.valueDelta, {
            reason: dto.note ?? 'รับโอน',
            refType: 'transfer',
            refId: transferId,
            userId: u.id,
          });
        }
        return { ok: true, transferId };
      }),
    );
  }

  /** ตรวจนับสต็อก: ปรับคงเหลือเป็นยอดที่นับได้ และเก็บประวัติการนับ */
  count(u: AuthUser, dto: { note?: string; lines: { ingredientId: string; countedQty: number }[] }) {
    return this.wrap(() =>
      this.ds.transaction(async (em) => {
        const ids = dto.lines.map((l) => l.ingredientId);
        if (new Set(ids).size !== ids.length) throw new BadRequestException('มีวัตถุดิบซ้ำในใบตรวจนับ');
        await this.assertIngredients(em, ids);
        const levels = await this.lockLevels(em, u.branchId, ids);
        const countId = randomUUID();
        let adjusted = 0;
        let value = 0;
        for (const line of dto.lines) {
          const lvl = levels.get(line.ingredientId)!;
          const r = adjustTo(lvl, line.countedQty);
          if (r.qtyDelta === 0) continue;
          adjusted++;
          value += r.valueDelta;
          await this.record(em, lvl, r.next, 'adjust', r.qtyDelta, r.valueDelta, {
            reason: dto.note ?? 'ตรวจนับสต็อก',
            refType: 'count',
            refId: countId,
            userId: u.id,
          });
        }
        await em.save(
          em.create(StockCount, {
            id: countId,
            branchId: u.branchId,
            userId: u.id,
            note: dto.note ?? null,
            linesCounted: dto.lines.length,
            linesAdjusted: adjusted,
            valueDeltaSatang: value,
          }),
        );
        return { id: countId, linesCounted: dto.lines.length, linesAdjusted: adjusted, valueDeltaSatang: value };
      }),
    );
  }

  private mergeItems(items: { ingredientId: string; qty: number }[]) {
    const m = new Map<string, number>();
    for (const i of items) m.set(i.ingredientId, (m.get(i.ingredientId) ?? 0) + i.qty);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ingredientId, qty]) => ({ ingredientId, qty }));
  }

  // ================= queries =================

  async levels(u: AuthUser) {
    const rows: { id: string; name: string; unit: string; sku: string | null; reorderLevel: number; qty: number | null; value: string | null; lastIn: Date | null }[] =
      await this.ds.query(
        `SELECT i.id, i.name, i.unit, i.sku, i."reorderLevel", l.qty, l."valueSatang" AS value,
                (SELECT MAX(m."createdAt") FROM stock_movements m
                  WHERE m."branchId" = $1 AND m."ingredientId" = i.id AND m.type IN ('receive','transfer_in')) AS "lastIn"
           FROM ingredients i
           LEFT JOIN stock_levels l ON l."ingredientId" = i.id AND l."branchId" = $1
          WHERE i.active
          ORDER BY i.name`,
        [u.branchId],
      );
    return rows.map((r) => {
      const qty = r.qty ?? 0;
      const valueSatang = Number(r.value ?? 0);
      return {
        ingredientId: r.id,
        name: r.name,
        unit: r.unit,
        sku: r.sku,
        reorderLevel: r.reorderLevel,
        qty,
        valueSatang,
        avgCostSatang: avgCost({ qty, valueSatang }),
        low: qty <= r.reorderLevel,
        negative: qty < 0,
        lastInAt: r.lastIn,
      };
    });
  }

  movements(u: AuthUser, q: { ingredientId?: string; type?: MovementType; limit?: number }) {
    const qb = this.ds
      .getRepository(StockMovement)
      .createQueryBuilder('m')
      .leftJoin('m.ingredient', 'i')
      .addSelect(['i.name', 'i.unit'])
      .where('m.branchId = :b', { b: u.branchId })
      .orderBy('m.createdAt', 'DESC')
      .take(Math.min(q.limit ?? 200, 500));
    if (q.ingredientId) qb.andWhere('m.ingredientId = :i', { i: q.ingredientId });
    if (q.type) qb.andWhere('m.type = :t', { t: q.type });
    return qb.getMany();
  }

  /** ล็อตที่รับเข้าและจะหมดอายุภายใน N วัน (เฉพาะวัตถุดิบที่ยังมีคงเหลือ) */
  expiring(u: AuthUser, days: number) {
    return this.ds.query(
      `SELECT m.id, m."ingredientId", i.name, i.unit, m."qtyDelta" AS "receivedQty", m."expiryDate", m."createdAt" AS "receivedAt",
              l.qty AS "currentQty"
         FROM stock_movements m
         JOIN ingredients i ON i.id = m."ingredientId"
         JOIN stock_levels l ON l."ingredientId" = m."ingredientId" AND l."branchId" = m."branchId"
        WHERE m."branchId" = $1 AND m.type = 'receive' AND m."expiryDate" IS NOT NULL
          AND m."expiryDate" <= (now() AT TIME ZONE 'Asia/Bangkok')::date + $2::int
          AND m."expiryDate" >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 7
          AND l.qty > 0
        ORDER BY m."expiryDate"`,
      [u.branchId, days],
    );
  }

  /** ต้นทุนสูตรและกำไรขั้นต้นต่อเมนู (ใช้ต้นทุนเฉลี่ยของสาขาผู้ใช้) */
  async costing(u: AuthUser) {
    const [products, lines, levels] = await Promise.all([
      this.ds.getRepository(Product).find({ where: { active: true }, order: { name: 'ASC' } }),
      this.ds.getRepository(RecipeItem).find({ relations: { ingredient: true } }),
      this.ds.getRepository(StockLevel).find({ where: { branchId: u.branchId } }),
    ]);
    const cost = new Map(levels.map((l) => [l.ingredientId, avgCost(l)]));
    const byProduct = new Map<string, RecipeItem[]>();
    for (const l of lines) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
    return products.map((p) => {
      const recipe = byProduct.get(p.id) ?? [];
      const missingCost = recipe.filter((r) => !cost.get(r.ingredientId)).map((r) => r.ingredient.name);
      const c = recipeCost(recipe.map((r) => ({ qty: r.qty, unitCost: cost.get(r.ingredientId) ?? 0 })));
      return {
        productId: p.id,
        name: p.name,
        priceSatang: p.priceSatang,
        hasRecipe: recipe.length > 0,
        costSatang: c,
        marginSatang: p.priceSatang - c,
        marginPct: p.priceSatang > 0 ? Math.round(((p.priceSatang - c) / p.priceSatang) * 1000) / 10 : 0,
        /** วัตถุดิบที่ยังไม่มีต้นทุน (ยังไม่เคยรับเข้า) — ต้นทุนจึงต่ำกว่าจริง */
        missingCost,
      };
    });
  }

  // ================= recipes =================

  async getRecipe(productId: string) {
    const p = await this.ds.getRepository(Product).findOneBy({ id: productId });
    if (!p) throw new NotFoundException('ไม่พบเมนู');
    const items = await this.ds.getRepository(RecipeItem).find({ where: { productId }, relations: { ingredient: true }, order: { qty: 'DESC' } });
    return { productId, name: p.name, priceSatang: p.priceSatang, items: items.map((i) => ({ ingredientId: i.ingredientId, name: i.ingredient.name, unit: i.ingredient.unit, qty: i.qty })) };
  }

  /** แทนที่สูตรทั้งชุด (ส่งรายการว่าง = ลบสูตร) */
  async setRecipe(u: AuthUser, productId: string, items: { ingredientId: string; qty: number }[]) {
    await this.ds.transaction(async (em) => {
      if (!(await em.existsBy(Product, { id: productId }))) throw new NotFoundException('ไม่พบเมนู');
      const ids = items.map((i) => i.ingredientId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('มีวัตถุดิบซ้ำในสูตร');
      if (ids.length) await this.assertIngredients(em, ids);
      await em.delete(RecipeItem, { productId });
      if (items.length) await em.save(items.map((i) => em.create(RecipeItem, { productId, ingredientId: i.ingredientId, qty: i.qty })));
      await em.save(
        em.create(AuditLog, { branchId: u.branchId, userId: u.id, action: 'recipe.update', entity: 'product', entityId: productId, detail: { items } }),
      );
    });
    return this.getRecipe(productId);
  }
}
