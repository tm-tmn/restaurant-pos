import { MigrationInterface, QueryRunner } from 'typeorm';

/** ตารางที่แยกข้อมูลตามร้าน — ทุกตารางมี "tenantId" และเปิด Row-Level Security */
export const TENANT_TABLES = ['branches', 'users', 'categories', 'products', 'dining_tables', 'shifts', 'orders', 'order_items', 'payments', 'audit_logs', 'daily_counters', 'ingredients', 'recipe_items', 'stock_levels', 'stock_movements', 'stock_counts', 'queue_tickets', 'queue_counters', 'payment_intents'];

/**
 * คอลัมน์ที่อ้างอิงแถวในตารางอื่น → ต้องเป็นของร้านเดียวกัน
 * (foreign key ของ PostgreSQL ตรวจโดยไม่สน RLS จึงต้องมี trigger ตรวจซ้ำ — กันการแอบผูกข้อมูลกับ id ของร้านอื่น)
 */
export const TENANT_REFS: Record<string, [column: string, refTable: string][]> = {
    users: [['branchId', 'branches']],
    products: [['categoryId', 'categories']],
    dining_tables: [['branchId', 'branches']],
    shifts: [['branchId', 'branches']],
    orders: [['branchId', 'branches'], ['tableId', 'dining_tables'], ['shiftId', 'shifts']],
    order_items: [['orderId', 'orders'], ['productId', 'products']],
    payments: [['orderId', 'orders']],
    audit_logs: [['branchId', 'branches']],
    daily_counters: [['branchId', 'branches']],
    recipe_items: [['productId', 'products'], ['ingredientId', 'ingredients']],
    stock_levels: [['branchId', 'branches'], ['ingredientId', 'ingredients']],
    stock_movements: [['branchId', 'branches'], ['ingredientId', 'ingredients']],
    stock_counts: [['branchId', 'branches']],
    queue_tickets: [['branchId', 'branches'], ['tableId', 'dining_tables']],
    queue_counters: [['branchId', 'branches']],
    payment_intents: [['branchId', 'branches'], ['orderId', 'orders']],
};

/**
 * รองรับหลายร้าน (multi-tenant) ในฐานข้อมูลเดียว:
 *  1. ตาราง tenants + เพิ่ม "tenantId" ทุกตาราง
 *  2. ข้อมูลเดิม (ระบบที่ติดตั้งก่อนหน้า) ย้ายไปอยู่ใต้ร้านตั้งต้นหนึ่งร้าน — รหัสร้านจาก DEFAULT_TENANT_SLUG (ค่าเริ่มต้น "main")
 *  3. ค่าที่ต้องไม่ซ้ำ (รหัสสาขา, ชื่อผู้ใช้, SKU, บาร์โค้ด, ชื่อวัตถุดิบ) เปลี่ยนเป็นไม่ซ้ำ "ภายในร้าน"
 *  4. role pos_app (ไม่มีสิทธิ์ข้าม RLS) + policy: เห็น/เขียนได้เฉพาะแถวที่ "tenantId" = app.tenant_id
 */
export class MultiTenant1793260450268 implements MigrationInterface {
    name = 'MultiTenant1793260450268'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_5b05b9a8ebdfcc8135d5244948"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95edd57ddda42e3e9e50ee00ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2a1b0f975fbe0df79f3b142b1d"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP CONSTRAINT "UQ_9c06cbb83feb2f0be6263bd47ee"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710"`);
        await queryRunner.query(`ALTER TABLE "ingredients" DROP CONSTRAINT "UQ_a955029b22ff66ae9fef2e161f8"`);
        await queryRunner.query(`CREATE TABLE "tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "name" character varying NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2310ecc5cb8be427097154b18fc" UNIQUE ("slug"), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`);

        // ร้านของ connection ปัจจุบัน (แอปตั้ง app.tenant_id ทุกครั้งที่ยืม connection) — ไม่มีค่า = NULL = ไม่เห็นอะไรเลย
        await queryRunner.query(`CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$`);

        // ---- ข้อมูลเดิม → ร้านตั้งต้น ----
        const slug = (process.env.DEFAULT_TENANT_SLUG ?? 'main').toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) throw new Error('DEFAULT_TENANT_SLUG ใช้ได้เฉพาะ a-z 0-9 - ยาว 2-31 ตัว');
        const hasData = (await queryRunner.query(`SELECT 1 FROM "branches" LIMIT 1`)).length > 0;
        let defaultTenant: string | null = null;
        if (hasData) {
            const [b] = await queryRunner.query(`SELECT "name" FROM "branches" ORDER BY "createdAt" LIMIT 1`);
            const [t] = await queryRunner.query(`INSERT INTO "tenants" ("slug", "name") VALUES ($1, $2) RETURNING "id"`, [slug, b.name]);
            defaultTenant = t.id;
        }
        for (const table of TENANT_TABLES) {
            await queryRunner.query(`ALTER TABLE "${table}" ADD "tenantId" uuid`);
            if (defaultTenant) await queryRunner.query(`UPDATE "${table}" SET "tenantId" = $1`, [defaultTenant]);
            await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "tenantId" SET NOT NULL`);
            await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "tenantId" SET DEFAULT app_tenant_id()`);
        }

        await queryRunner.query(`CREATE INDEX "IDX_46a85229c9953b2b94f768190b" ON "categories"  ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6804855ba1a19523ea57e0769b" ON "products"  ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bf2396a73f9825200dfd034b92" ON "products"  ("tenantId", "barcode") WHERE "barcode" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f65f17e234cfd169b12972a52d" ON "products"  ("tenantId", "sku") WHERE "sku" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_adbc8149b80856070a16ae319e" ON "ingredients"  ("tenantId", "sku") WHERE "sku" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "branches" ADD CONSTRAINT "UQ_b9207dc91aa5d9ee4cc0ded9c41" UNIQUE ("tenantId", "code")`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_4ac14983b3dd2b531c6537b5397" UNIQUE ("tenantId", "username")`);
        await queryRunner.query(`ALTER TABLE "ingredients" ADD CONSTRAINT "UQ_c0304e120e34e63a0706a4cfe8e" UNIQUE ("tenantId", "name")`);

        // ---- Row-Level Security ----
        // role ระดับ cluster: สร้างครั้งเดียว (ฐานข้อมูลอื่นใน cluster เดียวกันอาจสร้างไว้แล้ว)
        await queryRunner.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN CREATE ROLE pos_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`);
        // ผู้ใช้ที่แอปใช้ต่อฐานข้อมูลต้อง SET ROLE เป็น pos_app ได้
        await queryRunner.query(`DO $$ BEGIN EXECUTE format('GRANT pos_app TO %I', current_user); EXCEPTION WHEN others THEN RAISE NOTICE 'grant pos_app: %', SQLERRM; END $$`);
        await queryRunner.query(`GRANT USAGE ON SCHEMA public TO pos_app`);
        await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app`);
        await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_app`);
        await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app`);
        await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO pos_app`);
        // ตาราง migrations เป็นของระบบ — แอปไม่ต้องแตะ; เปิด RLS ไว้โดยไม่มี policy = มีแค่เจ้าของตารางที่เข้าถึงได้
        await queryRunner.query(`REVOKE ALL ON "migrations" FROM pos_app`);
        await queryRunner.query(`ALTER TABLE "migrations" ENABLE ROW LEVEL SECURITY`);
        // Supabase เปิด REST API (PostgREST) ให้ตารางใน public ผ่าน role anon/authenticated โดยอัตโนมัติ — แอปนี้ไม่ใช้ จึงถอนสิทธิ์ออก
        await queryRunner.query(`DO $$
            DECLARE r text;
            BEGIN
                FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
                        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
                        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
                        EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
                    END IF;
                END LOOP;
            END $$`);

        for (const table of TENANT_TABLES) {
            await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
            await queryRunner.query(`CREATE POLICY tenant_isolation ON "${table}" USING ("tenantId" = app_tenant_id()) WITH CHECK ("tenantId" = app_tenant_id())`);
        }
        // ---- ห้ามอ้างอิงข้ามร้าน ----
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION enforce_same_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                i int := 0;
                col text;
                val text;
                found boolean;
                newj jsonb := to_jsonb(NEW);
                oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
            BEGIN
                WHILE i < TG_NARGS LOOP
                    col := TG_ARGV[i];
                    val := newj ->> col;
                    IF val IS NOT NULL AND (oldj IS NULL OR val IS DISTINCT FROM oldj ->> col OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId") THEN
                        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1::uuid AND "tenantId" = $2)', TG_ARGV[i + 1])
                            INTO found USING val, NEW."tenantId";
                        IF NOT found THEN
                            RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = format('%s.%s อ้างอิงข้อมูลที่ไม่มีอยู่ในร้านนี้', TG_TABLE_NAME, col);
                        END IF;
                    END IF;
                    i := i + 2;
                END LOOP;
                RETURN NEW;
            END $$`);
        for (const [table, refs] of Object.entries(TENANT_REFS)) {
            const args = refs.flatMap(([c, r]) => [c, r]).map((a) => `'${a}'`).join(', ');
            await queryRunner.query(`CREATE TRIGGER same_tenant BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION enforce_same_tenant(${args})`);
        }

        await queryRunner.query(`ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY`);
        // แอปในนามร้านอ่านข้อมูลร้านตัวเองได้ แต่สร้าง/แก้ข้อมูลร้านไม่ได้ (ทำผ่านสคริปต์ผู้ดูแลระบบเท่านั้น)
        await queryRunner.query(`CREATE POLICY tenant_self ON "tenants" FOR SELECT USING ("id" = app_tenant_id())`);
        await queryRunner.query(`REVOKE INSERT, UPDATE, DELETE ON "tenants" FROM pos_app`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP POLICY IF EXISTS tenant_self ON "tenants"`);
        for (const table of Object.keys(TENANT_REFS)) await queryRunner.query(`DROP TRIGGER IF EXISTS same_tenant ON "${table}"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_same_tenant()`);
        for (const table of TENANT_TABLES) {
            await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
            await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
        }
        // ไม่ลบ role pos_app (เป็นของทั้ง cluster) — แค่ถอนสิทธิ์ในฐานข้อมูลนี้
        await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM pos_app`);
        await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM pos_app`);
        await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pos_app`);
        await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pos_app`);
        await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM pos_app`);
        await queryRunner.query(`ALTER TABLE "migrations" DISABLE ROW LEVEL SECURITY`);
        // หมายเหตุ: ถ้ามีหลายร้านแล้ว การย้อนกลับจะทำให้ข้อมูลทุกร้านรวมกัน และค่าที่ซ้ำข้ามร้านจะทำให้สร้าง unique เดิมไม่ได้
        await queryRunner.query(`ALTER TABLE "ingredients" DROP CONSTRAINT "UQ_c0304e120e34e63a0706a4cfe8e"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_4ac14983b3dd2b531c6537b5397"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP CONSTRAINT "UQ_b9207dc91aa5d9ee4cc0ded9c41"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_adbc8149b80856070a16ae319e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f65f17e234cfd169b12972a52d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf2396a73f9825200dfd034b92"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6804855ba1a19523ea57e0769b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_46a85229c9953b2b94f768190b"`);
        await queryRunner.query(`ALTER TABLE "ingredients" ADD CONSTRAINT "UQ_a955029b22ff66ae9fef2e161f8" UNIQUE ("name")`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username")`);
        await queryRunner.query(`ALTER TABLE "branches" ADD CONSTRAINT "UQ_9c06cbb83feb2f0be6263bd47ee" UNIQUE ("code")`);
        await queryRunner.query(`ALTER TABLE "payment_intents" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "queue_counters" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "queue_tickets" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "stock_counts" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "stock_movements" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "stock_levels" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "recipe_items" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "ingredients" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "daily_counters" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "dining_tables" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "categories" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "tenantId"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "tenantId"`);
        await queryRunner.query(`DROP TABLE "tenants"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS app_tenant_id()`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2a1b0f975fbe0df79f3b142b1d" ON "ingredients" USING btree ("sku") WHERE (sku IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_95edd57ddda42e3e9e50ee00ef" ON "products" USING btree ("barcode") WHERE (barcode IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5b05b9a8ebdfcc8135d5244948" ON "products" USING btree ("sku") WHERE (sku IS NOT NULL)`);
    }
}
