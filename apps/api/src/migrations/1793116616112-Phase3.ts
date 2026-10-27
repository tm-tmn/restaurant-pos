import { MigrationInterface, QueryRunner } from "typeorm";

export class Phase31793116616112 implements MigrationInterface {
    name = 'Phase31793116616112'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "queue_tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" character varying NOT NULL, "day" date NOT NULL, "number" integer NOT NULL, "partySize" integer NOT NULL, "name" character varying, "phone" character varying, "token" character varying(40) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'waiting', "source" character varying(10) NOT NULL DEFAULT 'staff', "callCount" integer NOT NULL DEFAULT '0', "tableId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "calledAt" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_c06116b05866e69cfa9a409aceb" UNIQUE ("token"), CONSTRAINT "UQ_2c05a06de01bfb708b23922ceb0" UNIQUE ("branchId", "day", "number"), CONSTRAINT "PK_1b903aa90bcc04136caa6540c55" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_eef9d86d6c659add8b03f918e9" ON "queue_tickets"  ("branchId", "day", "status") `);
        await queryRunner.query(`CREATE TABLE "queue_counters" ("branchId" character varying NOT NULL, "day" date NOT NULL, "n" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_2a9c24bf38a12b3dc708ce7be7a" PRIMARY KEY ("branchId", "day"))`);
        await queryRunner.query(`CREATE TABLE "payment_intents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "branchId" character varying NOT NULL, "orderId" uuid NOT NULL, "amountSatang" integer NOT NULL, "discountSatang" integer NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'pending', "qrPayload" text NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "txnId" character varying, "paidAmountSatang" integer, "paidAt" TIMESTAMP WITH TIME ZONE, "note" character varying, "createdBy" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_cc99975b98c8001a336976fd018" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_eabf248edbad66bde40d1489e8" ON "payment_intents"  ("txnId") WHERE "txnId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_122b10a11eacb7cf7d3fff96f1" ON "payment_intents"  ("orderId", "status") `);
        await queryRunner.query(`ALTER TABLE "branches" ADD "qrOrdering" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "branches" ADD "qrRequireApproval" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "dining_tables" ADD "qrToken" character varying(40)`);
        // โต๊ะที่มีอยู่แล้วต้องได้โทเค็นสุ่มของตัวเอง (122 บิตจาก gen_random_uuid) ก่อนบังคับ NOT NULL
        await queryRunner.query(`UPDATE "dining_tables" SET "qrToken" = replace(gen_random_uuid()::text, '-', '')`);
        await queryRunner.query(`ALTER TABLE "dining_tables" ALTER COLUMN "qrToken" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dining_tables" ADD CONSTRAINT "UQ_d22815e3d2d3c0a979520a78d3a" UNIQUE ("qrToken")`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD "kitchenStatus" character varying(12) NOT NULL DEFAULT 'new'`);
        // รายการเก่าถือว่าเสิร์ฟแล้ว — ไม่ให้ท่วมจอครัวหลังอัปเดต
        await queryRunner.query(`UPDATE "order_items" SET "kitchenStatus" = 'served'`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD "source" character varying(10) NOT NULL DEFAULT 'staff'`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD "submissionId" uuid`);
        await queryRunner.query(`CREATE INDEX "idx_items_kitchen_open" ON "order_items"  ("kitchenStatus") WHERE "status" = 'active' AND "kitchenStatus" <> 'served'`);
        await queryRunner.query(`CREATE INDEX "IDX_f1d359a55923bb45b057fbdab0" ON "order_items"  ("orderId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f1d359a55923bb45b057fbdab0"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_kitchen_open"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "submissionId"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "source"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "kitchenStatus"`);
        await queryRunner.query(`ALTER TABLE "dining_tables" DROP CONSTRAINT "UQ_d22815e3d2d3c0a979520a78d3a"`);
        await queryRunner.query(`ALTER TABLE "dining_tables" DROP COLUMN "qrToken"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "qrRequireApproval"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "qrOrdering"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_122b10a11eacb7cf7d3fff96f1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eabf248edbad66bde40d1489e8"`);
        await queryRunner.query(`DROP TABLE "payment_intents"`);
        await queryRunner.query(`DROP TABLE "queue_counters"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_eef9d86d6c659add8b03f918e9"`);
        await queryRunner.query(`DROP TABLE "queue_tickets"`);
    }

}
