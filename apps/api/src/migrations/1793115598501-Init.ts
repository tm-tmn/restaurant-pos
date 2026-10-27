import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1793115598501 implements MigrationInterface {
    name = 'Init1793115598501'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "branches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "name" character varying NOT NULL, "promptpayId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9c06cbb83feb2f0be6263bd47ee" UNIQUE ("code"), CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" uuid NOT NULL, "username" character varying NOT NULL, "passwordHash" character varying NOT NULL, "displayName" character varying NOT NULL, "role" character varying(20) NOT NULL, "active" boolean NOT NULL DEFAULT true, "tokenVersion" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "categoryId" uuid, "name" character varying NOT NULL, "sku" character varying, "barcode" character varying, "priceSatang" integer NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5b05b9a8ebdfcc8135d5244948" ON "products"  ("sku") WHERE "sku" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_95edd57ddda42e3e9e50ee00ef" ON "products"  ("barcode") WHERE "barcode" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "dining_tables" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" character varying NOT NULL, "name" character varying NOT NULL, "seats" integer NOT NULL DEFAULT '4', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_872d10895d86b4289d6a42b4ab2" UNIQUE ("branchId", "name"), CONSTRAINT "PK_30bc22c71f39a9d32b7f7617757" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "shifts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" character varying NOT NULL, "openedBy" character varying NOT NULL, "closedBy" uuid, "openingCashSatang" integer NOT NULL, "closingCashSatang" integer, "expectedCashSatang" integer, "openedAt" TIMESTAMP NOT NULL DEFAULT now(), "closedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_84d692e367e4d6cdf045828768c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_open_shift_per_branch" ON "shifts"  ("branchId") WHERE "closedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "clientId" uuid NOT NULL, "branchId" character varying NOT NULL, "tableId" uuid, "orderNo" character varying NOT NULL, "type" character varying(20) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'open', "subtotalSatang" integer NOT NULL DEFAULT '0', "discountSatang" integer NOT NULL DEFAULT '0', "totalSatang" integer NOT NULL DEFAULT '0', "note" character varying, "shiftId" uuid, "createdBy" character varying NOT NULL, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "paidAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_2152671bf0094459f6b68cd212c" UNIQUE ("branchId", "clientId"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_open_order_per_table" ON "orders"  ("tableId") WHERE "status" = 'open' AND "tableId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_8ee273203e92f6e5a20a9e4388" ON "orders"  ("branchId", "paidAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_8736d7c044929b8c3d4d63a763" ON "orders"  ("branchId", "status") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "productId" uuid, "nameSnapshot" character varying NOT NULL, "unitPriceSatang" integer NOT NULL, "qty" integer NOT NULL, "note" character varying, "status" character varying(10) NOT NULL DEFAULT 'active', "voidReason" character varying, "sentToKitchenAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "method" character varying(12) NOT NULL, "amountSatang" integer NOT NULL, "receivedSatang" integer NOT NULL, "changeSatang" integer NOT NULL DEFAULT '0', "reference" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" character varying NOT NULL, "userId" uuid, "action" character varying NOT NULL, "entity" character varying NOT NULL, "entityId" character varying, "detail" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "daily_counters" ("branchId" character varying NOT NULL, "day" date NOT NULL, "n" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_a29bc7bfe3cc169868c918e86df" PRIMARY KEY ("branchId", "day"))`);
        await queryRunner.query(`CREATE TABLE "ingredients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "unit" character varying(8) NOT NULL, "sku" character varying, "reorderLevel" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a955029b22ff66ae9fef2e161f8" UNIQUE ("name"), CONSTRAINT "PK_9240185c8a5507251c9f15e0649" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2a1b0f975fbe0df79f3b142b1d" ON "ingredients"  ("sku") WHERE "sku" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "recipe_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "ingredientId" uuid NOT NULL, "qty" integer NOT NULL, CONSTRAINT "UQ_582e929f1e678a9ad24eb06846b" UNIQUE ("productId", "ingredientId"), CONSTRAINT "PK_daec78e42198e9c42e1fed60eec" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b469c2e7e39bd3e4d945bf13b5" ON "recipe_items"  ("productId") `);
        await queryRunner.query(`CREATE TABLE "stock_levels" ("branchId" uuid NOT NULL, "ingredientId" uuid NOT NULL, "qty" integer NOT NULL DEFAULT '0', "valueSatang" bigint NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a1c204c994789792a0156334a7b" PRIMARY KEY ("branchId", "ingredientId"))`);
        await queryRunner.query(`CREATE TABLE "stock_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" uuid NOT NULL, "ingredientId" uuid NOT NULL, "type" character varying(16) NOT NULL, "qtyDelta" integer NOT NULL, "valueDeltaSatang" bigint NOT NULL, "balanceQty" integer NOT NULL, "reason" character varying, "refType" character varying(16), "refId" uuid, "expiryDate" date, "supplier" character varying, "userId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8ff549128dbd87e4b9d15c3d4a" ON "stock_movements"  ("refType", "refId") `);
        await queryRunner.query(`CREATE INDEX "IDX_70d6961b31a880aaa06c7c003e" ON "stock_movements"  ("branchId", "ingredientId", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_def5504957af136b281527864d" ON "stock_movements"  ("branchId", "createdAt") `);
        await queryRunner.query(`CREATE TABLE "stock_counts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" uuid NOT NULL, "userId" uuid NOT NULL, "note" character varying, "linesCounted" integer NOT NULL, "linesAdjusted" integer NOT NULL, "valueDeltaSatang" bigint NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_75fe54546dc8247c6a33a1707c9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_246426dfd001466a1d5e47322f4" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_ff56834e735fa78a15d0cf21926" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payments" ADD CONSTRAINT "FK_af929a5f2a400fdb6913b4967e1" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "recipe_items" ADD CONSTRAINT "FK_7e1edd294cc3ea5a86baa9a6bfd" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_levels" ADD CONSTRAINT "FK_a41fb78617d4f85ffe40bf48c55" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_be5d766003a1ab7ac1277bc9b3a" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_be5d766003a1ab7ac1277bc9b3a"`);
        await queryRunner.query(`ALTER TABLE "stock_levels" DROP CONSTRAINT "FK_a41fb78617d4f85ffe40bf48c55"`);
        await queryRunner.query(`ALTER TABLE "recipe_items" DROP CONSTRAINT "FK_7e1edd294cc3ea5a86baa9a6bfd"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT "FK_af929a5f2a400fdb6913b4967e1"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_f1d359a55923bb45b057fbdab0d"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_ff56834e735fa78a15d0cf21926"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_246426dfd001466a1d5e47322f4"`);
        await queryRunner.query(`DROP TABLE "stock_counts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_def5504957af136b281527864d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_70d6961b31a880aaa06c7c003e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ff549128dbd87e4b9d15c3d4a"`);
        await queryRunner.query(`DROP TABLE "stock_movements"`);
        await queryRunner.query(`DROP TABLE "stock_levels"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b469c2e7e39bd3e4d945bf13b5"`);
        await queryRunner.query(`DROP TABLE "recipe_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2a1b0f975fbe0df79f3b142b1d"`);
        await queryRunner.query(`DROP TABLE "ingredients"`);
        await queryRunner.query(`DROP TABLE "daily_counters"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8736d7c044929b8c3d4d63a763"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ee273203e92f6e5a20a9e4388"`);
        await queryRunner.query(`DROP INDEX "public"."uq_open_order_per_table"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP INDEX "public"."uq_open_shift_per_branch"`);
        await queryRunner.query(`DROP TABLE "shifts"`);
        await queryRunner.query(`DROP TABLE "dining_tables"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95edd57ddda42e3e9e50ee00ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5b05b9a8ebdfcc8135d5244948"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "branches"`);
    }

}
