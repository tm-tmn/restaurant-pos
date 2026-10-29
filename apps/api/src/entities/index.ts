import { randomBytes } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type Role = 'owner' | 'manager' | 'cashier';
export type OrderStatus = 'open' | 'paid' | 'void';
export type OrderType = 'dine_in' | 'takeaway';
export type PaymentMethod = 'cash' | 'promptpay' | 'card';

export const newQrToken = () => randomBytes(16).toString('hex');

/**
 * ทุกตาราง (ยกเว้น tenants) มีคอลัมน์ tenantId = ร้านเจ้าของแถว
 * ค่าเริ่มต้นมาจาก app.tenant_id ของ connection (แอปตั้งให้อัตโนมัติ) — โค้ดจึงไม่ต้องใส่เองตอน insert
 * และ Row-Level Security ใน PostgreSQL บังคับให้อ่าน/เขียนได้เฉพาะแถวของร้านตัวเอง
 */
// app_tenant_id() = NULLIF(current_setting('app.tenant_id', true), '')::uuid (สร้างใน migration MultiTenant)
export const TENANT_DEFAULT = 'app_tenant_id()';
const TenantColumn = () => Column({ type: 'uuid', default: () => TENANT_DEFAULT });

export type TenantStatus = 'active' | 'suspended';

/** ร้าน (ลูกค้าของระบบ) — หนึ่งร้านมีได้หลายสาขา */
@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** รหัสร้านที่พนักงานพิมพ์ตอนล็อกอิน และอยู่ในลิงก์สาธารณะ เช่น /q/<slug>/MAIN */
  @Column({ unique: true }) slug: string;
  @Column() name: string;
  @Column({ type: 'varchar', length: 12, default: 'active' }) status: TenantStatus;
  @CreateDateColumn() createdAt: Date;
}

/** เงินทุกช่องเก็บเป็นจำนวนเต็ม "สตางค์" */

@Entity('branches')
@Unique(['tenantId', 'code'])
export class Branch {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() code: string;
  @Column() name: string;
  /** เบอร์โทร/เลขบัตรประชาชน/เลขผู้เสียภาษี ที่ผูกกับ PromptPay ของร้าน */
  @Column({ type: 'varchar', nullable: true }) promptpayId: string | null;
  /** เปิดให้ลูกค้าสแกน QR ที่โต๊ะเพื่อสั่งอาหารเอง */
  @Column({ default: true }) qrOrdering: boolean;
  /** รายการที่ลูกค้าสั่งเองต้องให้พนักงานกดยืนยันก่อนเข้าครัว (กันสั่งแกล้ง) */
  @Column({ default: true }) qrRequireApproval: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('users')
@Unique(['tenantId', 'username'])
export class User {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @ManyToOne(() => Branch) @JoinColumn({ name: 'branchId' }) branch: Branch;
  @Column() username: string;
  @Column({ select: false }) passwordHash: string;
  @Column() displayName: string;
  @Column({ type: 'varchar', length: 20 }) role: Role;
  @Column({ default: true }) active: boolean;
  /** เพิ่มทุกครั้งที่เปลี่ยนรหัสผ่าน/ปิดใช้งาน — โทเค็นเก่าที่มีเลขไม่ตรงจะใช้ไม่ได้ทันที */
  @Column({ type: 'int', default: 0 }) tokenVersion: number;
  @CreateDateColumn() createdAt: Date;
}

@Entity('categories')
@Index(['tenantId'])
export class Category {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ type: 'int', default: 0 }) sortOrder: number;
  @Column({ default: true }) active: boolean;
  @OneToMany(() => Product, (p) => p.category) products: Product[];
}

@Entity('products')
@Index(['tenantId', 'sku'], { unique: true, where: '"sku" IS NOT NULL' })
@Index(['tenantId', 'barcode'], { unique: true, where: '"barcode" IS NOT NULL' })
@Index(['tenantId'])
export class Product {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) categoryId: string | null;
  @ManyToOne(() => Category, (c) => c.products, { nullable: true })
  @JoinColumn({ name: 'categoryId' })
  category: Category | null;
  @Column() name: string;
  @Column({ type: 'varchar', nullable: true })
  sku: string | null;
  /** บาร์โค้ดสำหรับ Quick Scan */
  @Column({ type: 'varchar', nullable: true })
  barcode: string | null;
  @Column({ type: 'int' }) priceSatang: number;
  @Column({ type: 'int', default: 0 }) sortOrder: number;
  @Column({ default: true }) active: boolean;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('dining_tables')
@Unique(['branchId', 'name'])
export class DiningTable {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @Column() name: string;
  @Column({ type: 'int', default: 4 }) seats: number;
  @Column({ default: true }) active: boolean;
  /** โทเค็นสุ่มใน QR ประจำโต๊ะ (หมุนเปลี่ยนได้ถ้า QR หลุดไปนอกร้าน) */
  @Column({ type: 'varchar', length: 40, unique: true }) qrToken: string;
  @BeforeInsert() private ensureToken() {
    this.qrToken ??= newQrToken();
  }
}

@Entity('shifts')
// หนึ่งสาขาเปิดกะได้ทีละกะ (กันกดเปิดพร้อมกันจากหลายเครื่อง)
@Index('uq_open_shift_per_branch', ['branchId'], { unique: true, where: '"closedAt" IS NULL' })
export class Shift {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @Column() openedBy: string;
  @Column({ type: 'uuid', nullable: true }) closedBy: string | null;
  @Column({ type: 'int' }) openingCashSatang: number;
  @Column({ type: 'int', nullable: true }) closingCashSatang: number | null;
  /** เงินสดที่ควรมีในลิ้นชัก ณ ตอนปิดกะ = เงินเปิดกะ + เงินสดรับสุทธิ */
  @Column({ type: 'int', nullable: true }) expectedCashSatang: number | null;
  @CreateDateColumn() openedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) closedAt: Date | null;
}

@Entity('orders')
@Unique(['branchId', 'clientId'])
@Index(['branchId', 'status'])
@Index(['branchId', 'paidAt'])
// หนึ่งโต๊ะมีบิลเปิดได้ทีละบิลเดียว (กัน race เมื่อสองเครื่องเปิดโต๊ะพร้อมกัน)
@Index('uq_open_order_per_table', ['tableId'], { unique: true, where: `"status" = 'open' AND "tableId" IS NOT NULL` })
export class Order {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  /** UUID ที่เครื่อง POS สร้างเอง ใช้ป้องกันออเดอร์ซ้ำเมื่อซิงค์ซ้ำ (idempotency) */
  @Column('uuid') clientId: string;
  @Column() branchId: string;
  @Column({ type: 'uuid', nullable: true }) tableId: string | null;
  @Column() orderNo: string;
  @Column({ type: 'varchar', length: 20 }) type: OrderType;
  @Column({ type: 'varchar', length: 10, default: 'open' }) status: OrderStatus;
  @Column({ type: 'int', default: 0 }) subtotalSatang: number;
  @Column({ type: 'int', default: 0 }) discountSatang: number;
  @Column({ type: 'int', default: 0 }) totalSatang: number;
  @Column({ type: 'varchar', nullable: true }) note: string | null;
  @Column({ type: 'uuid', nullable: true }) shiftId: string | null;
  @Column() createdBy: string;
  /** เวลาที่เกิดขายจริงที่เครื่อง POS (กรณี offline จะเก่ากว่า createdAt ของเซิร์ฟเวอร์) */
  @Column({ type: 'timestamptz' }) occurredAt: Date;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @OneToMany(() => OrderItem, (i) => i.order, { cascade: true }) items: OrderItem[];
  @OneToMany(() => Payment, (p) => p.order, { cascade: true }) payments: Payment[];
}

export type KitchenStatus = 'new' | 'preparing' | 'ready' | 'served';
/** active = เข้าบิลแล้ว, pending = ลูกค้าสั่งผ่าน QR รอพนักงานยืนยัน (ยังไม่นับยอด), void = ยกเลิก */
export type ItemStatus = 'active' | 'pending' | 'void';

@Entity('order_items')
@Index(['orderId'])
// ดึงรายการที่ครัวยังต้องทำ (จอครัว) โดยไม่ต้องกวาดทั้งตาราง
@Index('idx_items_kitchen_open', ['kitchenStatus'], { where: `"status" = 'active' AND "kitchenStatus" <> 'served'` })
export class OrderItem {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() orderId: string;
  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;
  @Column({ type: 'uuid', nullable: true }) productId: string | null;
  /** snapshot ชื่อ/ราคา ณ ตอนขาย — แก้เมนูภายหลังไม่กระทบบิลเก่า */
  @Column() nameSnapshot: string;
  @Column({ type: 'int' }) unitPriceSatang: number;
  @Column({ type: 'int' }) qty: number;
  @Column({ type: 'varchar', nullable: true }) note: string | null;
  @Column({ type: 'varchar', length: 10, default: 'active' }) status: ItemStatus;
  @Column({ type: 'varchar', length: 12, default: 'new' }) kitchenStatus: KitchenStatus;
  @Column({ type: 'varchar', length: 10, default: 'staff' }) source: 'staff' | 'customer';
  /** รหัสการส่งออเดอร์หนึ่งครั้งจากหน้าลูกค้า — ส่งซ้ำ (เน็ตหลุด/กดซ้ำ) จะไม่เกิดรายการซ้ำ */
  @Column({ type: 'uuid', nullable: true }) submissionId: string | null;
  @Column({ type: 'varchar', nullable: true }) voidReason: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sentToKitchenAt: Date | null;
}

@Entity('payments')
export class Payment {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() orderId: string;
  @ManyToOne(() => Order, (o) => o.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;
  @Column({ type: 'varchar', length: 12 }) method: PaymentMethod;
  @Column({ type: 'int' }) amountSatang: number;
  @Column({ type: 'int' }) receivedSatang: number;
  @Column({ type: 'int', default: 0 }) changeSatang: number;
  @Column({ type: 'varchar', nullable: true }) reference: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @Column() action: string;
  @Column() entity: string;
  @Column({ type: 'varchar', nullable: true }) entityId: string | null;
  @Column({ type: 'jsonb', nullable: true }) detail: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}

/** ตัวนับเลขที่บิลต่อสาขาต่อวัน (atomic ด้วย INSERT ... ON CONFLICT) */
@Entity('daily_counters')
export class DailyCounter {
  @TenantColumn() tenantId: string;
  @PrimaryColumn() branchId: string;
  @PrimaryColumn({ type: 'date' }) day: string;
  @Column({ type: 'int', default: 0 }) n: number;
}

// =================== Phase 2: Inventory & BOM ===================

/** หน่วยฐานที่ใช้เก็บปริมาณเป็นจำนวนเต็ม */
export type BaseUnit = 'g' | 'ml' | 'pcs';
export type MovementType = 'receive' | 'issue' | 'waste' | 'transfer_out' | 'transfer_in' | 'sale' | 'adjust';

@Entity('ingredients')
@Unique(['tenantId', 'name'])
@Index(['tenantId', 'sku'], { unique: true, where: '"sku" IS NOT NULL' })
export class Ingredient {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ type: 'varchar', length: 8 }) unit: BaseUnit;
  @Column({ type: 'varchar', nullable: true })
  sku: string | null;
  /** แจ้งเตือนเมื่อคงเหลือต่ำกว่าค่านี้ (หน่วยฐาน) */
  @Column({ type: 'int', default: 0 }) reorderLevel: number;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn() createdAt: Date;
}

/** สูตรอาหาร (Bill of Materials): เมนู 1 จานใช้วัตถุดิบเท่าไร */
@Entity('recipe_items')
@Unique(['productId', 'ingredientId'])
export class RecipeItem {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column('uuid') productId: string;
  @Column('uuid') ingredientId: string;
  @ManyToOne(() => Ingredient) @JoinColumn({ name: 'ingredientId' }) ingredient: Ingredient;
  /** ปริมาณต่อ 1 จาน (หน่วยฐาน) */
  @Column({ type: 'int' }) qty: number;
}

/** คงเหลือต่อสาขา: ปริมาณ + มูลค่า (ต้นทุนเฉลี่ย = value/qty) */
@Entity('stock_levels')
export class StockLevel {
  @TenantColumn() tenantId: string;
  @PrimaryColumn('uuid') branchId: string;
  @PrimaryColumn('uuid') ingredientId: string;
  @ManyToOne(() => Ingredient) @JoinColumn({ name: 'ingredientId' }) ingredient: Ingredient;
  @Column({ type: 'int', default: 0 }) qty: number;
  @Column({ type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  valueSatang: number;
  @UpdateDateColumn() updatedAt: Date;
}

/** สมุดบัญชีสต็อก (ledger) — ทุกการเปลี่ยนแปลงคงเหลือต้องมีแถวที่นี่ ไม่แก้ไข/ลบ */
@Entity('stock_movements')
@Index(['branchId', 'createdAt'])
@Index(['branchId', 'ingredientId', 'createdAt'])
@Index(['refType', 'refId'])
export class StockMovement {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') branchId: string;
  @Column('uuid') ingredientId: string;
  @ManyToOne(() => Ingredient) @JoinColumn({ name: 'ingredientId' }) ingredient: Ingredient;
  @Column({ type: 'varchar', length: 16 }) type: MovementType;
  @Column({ type: 'int' }) qtyDelta: number;
  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) valueDeltaSatang: number;
  /** คงเหลือหลังรายการนี้ — ใช้ตรวจย้อนหลังได้โดยไม่ต้องรวมใหม่ */
  @Column({ type: 'int' }) balanceQty: number;
  @Column({ type: 'varchar', nullable: true }) reason: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) refType: 'order' | 'transfer' | 'count' | null;
  @Column({ type: 'uuid', nullable: true }) refId: string | null;
  /** วันหมดอายุของล็อตที่รับเข้า (ถ้ามี) */
  @Column({ type: 'date', nullable: true }) expiryDate: string | null;
  @Column({ type: 'varchar', nullable: true }) supplier: string | null;
  @Column({ type: 'uuid', nullable: true }) userId: string | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('stock_counts')
export class StockCount {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') branchId: string;
  @Column('uuid') userId: string;
  @Column({ type: 'varchar', nullable: true }) note: string | null;
  @Column({ type: 'int' }) linesCounted: number;
  @Column({ type: 'int' }) linesAdjusted: number;
  @Column({ type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } }) valueDeltaSatang: number;
  @CreateDateColumn() createdAt: Date;
}

// =================== Phase 3: QR ordering, kitchen, queue, payments ===================

export type QueueStatus = 'waiting' | 'called' | 'seated' | 'cancelled' | 'no_show';

/** บัตรคิว: ลูกค้ารอโต๊ะ (เข้าคิวเองผ่าน QR หน้าร้าน หรือพนักงานกดให้) */
@Entity('queue_tickets')
@Unique(['branchId', 'day', 'number'])
@Index(['branchId', 'day', 'status'])
export class QueueTicket {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @Column({ type: 'date' }) day: string;
  @Column({ type: 'int' }) number: number;
  @Column({ type: 'int' }) partySize: number;
  @Column({ type: 'varchar', nullable: true }) name: string | null;
  @Column({ type: 'varchar', nullable: true }) phone: string | null;
  /** โทเค็นสุ่มให้ลูกค้าเปิดดูสถานะคิวของตัวเอง */
  @Column({ type: 'varchar', length: 40, unique: true }) token: string;
  @Column({ type: 'varchar', length: 12, default: 'waiting' }) status: QueueStatus;
  @Column({ type: 'varchar', length: 10, default: 'staff' }) source: 'staff' | 'customer';
  @Column({ type: 'int', default: 0 }) callCount: number;
  @Column({ type: 'uuid', nullable: true }) tableId: string | null;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) calledAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) closedAt: Date | null;
}

@Entity('queue_counters')
export class QueueCounter {
  @TenantColumn() tenantId: string;
  @PrimaryColumn() branchId: string;
  @PrimaryColumn({ type: 'date' }) day: string;
  @Column({ type: 'int', default: 0 }) n: number;
}

/** pending = รอเงินเข้า, paid = ปิดบิลแล้ว, expired = QR หมดอายุ, cancelled = บิลเปลี่ยนจึงยกเลิก, review = เงินเข้าแต่จับคู่ไม่ได้ ต้องให้คนตรวจ */
export type IntentStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'review';

/** คำขอชำระด้วย PromptPay หนึ่งครั้ง — ผูกกับบิลและยอดที่ตรึงไว้ ณ ตอนสร้าง */
@Entity('payment_intents')
@Index(['orderId', 'status'])
export class PaymentIntent {
  @TenantColumn() tenantId: string;
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() branchId: string;
  @Column('uuid') orderId: string;
  @Column({ type: 'int' }) amountSatang: number;
  /** ส่วนลดที่ผู้จัดการอนุมัติตอนสร้าง (ใช้ตอนปิดบิลอัตโนมัติ) */
  @Column({ type: 'int', default: 0 }) discountSatang: number;
  @Column({ type: 'varchar', length: 10, default: 'pending' }) status: IntentStatus;
  @Column({ type: 'text' }) qrPayload: string;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  /** เลขธุรกรรมจากผู้ให้บริการ — unique กันเงินเข้าซ้ำถูกนับสองครั้ง */
  @Index({ unique: true, where: '"txnId" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  txnId: string | null;
  @Column({ type: 'int', nullable: true }) paidAmountSatang: number | null;
  @Column({ type: 'timestamptz', nullable: true }) paidAt: Date | null;
  @Column({ type: 'varchar', nullable: true }) note: string | null;
  /** ผู้สร้าง: พนักงาน (user id) หรือ 'customer-qr' */
  @Column() createdBy: string;
  @CreateDateColumn() createdAt: Date;
}

export const ALL_ENTITIES = [
  Tenant,
  Branch,
  User,
  Category,
  Product,
  DiningTable,
  Shift,
  Order,
  OrderItem,
  Payment,
  AuditLog,
  DailyCounter,
  Ingredient,
  RecipeItem,
  StockLevel,
  StockMovement,
  StockCount,
  QueueTicket,
  QueueCounter,
  PaymentIntent,
];
