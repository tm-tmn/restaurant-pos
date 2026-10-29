import { MigrationInterface, QueryRunner } from 'typeorm';

/** ตาราง → หัวข้อที่หน้าจอควรโหลดใหม่เมื่อแถวเปลี่ยน */
const TOPICS: Record<string, string> = {
    orders: 'orders,kitchen',
    order_items: 'orders,kitchen',
    payments: 'orders',
    payment_intents: 'orders',
    queue_tickets: 'queue',
};

/**
 * แจ้งเตือนแบบ real-time: ทุกครั้งที่บิล/รายการอาหาร/การชำระ/คิว เปลี่ยน ฐานข้อมูลส่ง NOTIFY ช่อง pos_events
 * เนื้อหาคือ {"b": สาขา, "t": หัวข้อ} เท่านั้น (ไม่มีข้อมูลจริง) — API กระจายต่อผ่าน WebSocket ให้เครื่องในสาขานั้นโหลดใหม่
 * NOTIFY ส่งเมื่อ commit แล้วเท่านั้น และข้อความซ้ำในทรานแซกชันเดียวกันถูกรวมเป็นครั้งเดียว
 * API ทุกตัวที่ LISTEN ได้รับเหมือนกัน → รันหลายเครื่องได้โดยไม่ต้องมี Redis
 */
export class Realtime1793260900000 implements MigrationInterface {
    name = 'Realtime1793260900000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION notify_pos_change() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                r record;
                b text;
            BEGIN
                IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
                IF TG_TABLE_NAME IN ('order_items', 'payments') THEN
                    SELECT "branchId"::text INTO b FROM orders WHERE id = r."orderId";
                ELSE
                    b := r."branchId"::text;
                END IF;
                IF b IS NOT NULL THEN
                    PERFORM pg_notify('pos_events', json_build_object('b', b, 't', TG_ARGV[0])::text);
                END IF;
                RETURN NULL;
            END $$`);
        for (const [table, topics] of Object.entries(TOPICS)) {
            await queryRunner.query(
                `CREATE TRIGGER pos_notify AFTER INSERT OR UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION notify_pos_change('${topics}')`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of Object.keys(TOPICS)) await queryRunner.query(`DROP TRIGGER IF EXISTS pos_notify ON "${table}"`);
        await queryRunner.query(`DROP FUNCTION IF EXISTS notify_pos_change()`);
    }
}
