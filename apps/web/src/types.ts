export type Role = 'owner' | 'manager' | 'cashier';
export type PaymentMethod = 'cash' | 'promptpay' | 'card';

/** ร้าน (หนึ่งระบบมีได้หลายร้าน) — slug คือรหัสร้านที่ใช้ล็อกอินและในลิงก์สาธารณะ */
export interface TenantInfo {
  slug: string;
  name: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  promptpayId: string | null;
  qrOrdering?: boolean;
  qrRequireApproval?: boolean;
}
export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}
export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}
export interface Product {
  id: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  priceSatang: number;
  sortOrder: number;
  active: boolean;
}
export interface Menu {
  categories: Category[];
  products: Product[];
  fetchedAt: string;
}
export interface TableInfo {
  id: string;
  name: string;
  seats: number;
  openOrder: { id: string; orderNo: string; totalSatang: number } | null;
}
export interface OrderItem {
  id: string;
  productId: string | null;
  nameSnapshot: string;
  unitPriceSatang: number;
  qty: number;
  note: string | null;
  status: 'active' | 'pending' | 'void';
  kitchenStatus?: KitchenStatus;
  source?: 'staff' | 'customer';
  voidReason: string | null;
}
export interface PaymentRow {
  id: string;
  method: PaymentMethod;
  amountSatang: number;
  receivedSatang: number;
  changeSatang: number;
}
export interface Order {
  id: string;
  orderNo: string;
  status: 'open' | 'paid' | 'void';
  type: 'dine_in' | 'takeaway';
  tableId: string | null;
  subtotalSatang: number;
  discountSatang: number;
  totalSatang: number;
  paidAt: string | null;
  items: OrderItem[];
  payments: PaymentRow[];
}
export interface PaymentInput {
  method: PaymentMethod;
  amountSatang: number;
  receivedSatang?: number;
  reference?: string;
}
export interface SyncOrderPayload {
  clientId: string;
  type: 'dine_in' | 'takeaway';
  occurredAt: string;
  discountSatang?: number;
  note?: string;
  items: { productId?: string; name: string; unitPriceSatang: number; qty: number; note?: string }[];
  payments: PaymentInput[];
}
export interface Shift {
  id: string;
  openingCashSatang: number;
  openedAt: string;
}
export interface DailyReport {
  date: string;
  orders: number;
  salesSatang: number;
  discountSatang: number;
  avgOrderSatang: number;
  voidedOrders: number;
  voidedItems: number;
  cogsSatang: number;
  grossProfitSatang: number;
  wasteSatang: number;
  byMethod: { method: PaymentMethod; amountSatang: number; count: number }[];
  topProducts: { name: string; qty: number; salesSatang: number }[];
  hourly: { hour: number; orders: number; salesSatang: number }[];
}
// ---------- Phase 2: Inventory ----------
export type BaseUnit = 'g' | 'ml' | 'pcs';
export type MovementType = 'receive' | 'issue' | 'waste' | 'transfer_out' | 'transfer_in' | 'sale' | 'adjust';

export interface Ingredient {
  id: string;
  name: string;
  unit: BaseUnit;
  sku: string | null;
  reorderLevel: number;
  active: boolean;
}
export interface StockRow {
  ingredientId: string;
  name: string;
  unit: BaseUnit;
  sku: string | null;
  reorderLevel: number;
  qty: number;
  valueSatang: number;
  avgCostSatang: number;
  low: boolean;
  negative: boolean;
  lastInAt: string | null;
}
export interface Movement {
  id: string;
  ingredientId: string;
  ingredient: { name: string; unit: BaseUnit };
  type: MovementType;
  qtyDelta: number;
  valueDeltaSatang: number;
  balanceQty: number;
  reason: string | null;
  refType: string | null;
  supplier: string | null;
  expiryDate: string | null;
  createdAt: string;
}
export interface ExpiringLot {
  id: string;
  ingredientId: string;
  name: string;
  unit: BaseUnit;
  receivedQty: number;
  currentQty: number;
  expiryDate: string;
  receivedAt: string;
}
export interface CostingRow {
  productId: string;
  name: string;
  priceSatang: number;
  hasRecipe: boolean;
  costSatang: number;
  marginSatang: number;
  marginPct: number;
  missingCost: string[];
}
export interface Recipe {
  productId: string;
  name: string;
  priceSatang: number;
  items: { ingredientId: string; name: string; unit: BaseUnit; qty: number }[];
}
export interface BranchLite {
  id: string;
  code: string;
  name: string;
}

export interface StaffUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}

// ---------- Phase 3 ----------
export type KitchenStatus = 'new' | 'preparing' | 'ready' | 'served';

export interface KitchenTicket {
  orderId: string;
  orderNo: string;
  type: 'dine_in' | 'takeaway';
  tableName: string | null;
  sentAt: string;
  items: { id: string; name: string; qty: number; note: string | null; status: KitchenStatus; source: 'staff' | 'customer'; sentAt: string }[];
}
export interface PendingGroup {
  orderId: string;
  orderNo: string;
  tableName: string | null;
  items: { itemId: string; name: string; qty: number; unitPriceSatang: number; note: string | null }[];
}
export type QueueStatus = 'waiting' | 'called' | 'seated' | 'cancelled' | 'no_show';
export interface QueueTicket {
  id: string;
  code: string;
  number: number;
  partySize: number;
  name: string | null;
  phone: string | null;
  status: QueueStatus;
  source: 'staff' | 'customer';
  callCount: number;
  createdAt: string;
  calledAt: string | null;
}
export type IntentStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'review';
export interface PaymentIntent {
  id: string;
  orderId: string;
  amountSatang: number;
  discountSatang: number;
  status: IntentStatus;
  qrPayload: string;
  expiresAt: string;
  note: string | null;
}
// หน้าลูกค้า (สาธารณะ)
export interface CustomerBill {
  totalSatang: number;
  items: { name: string; qty: number; unitPriceSatang: number; note: string | null; status: 'active' | 'pending' | 'void'; kitchenStatus: KitchenStatus }[];
}
export interface CustomerPage {
  branch: { name: string };
  table: { name: string };
  requireApproval: boolean;
  canPay: boolean;
  menu: {
    categories: { id: string; name: string }[];
    products: { id: string; name: string; priceSatang: number; categoryId: string | null }[];
  };
  order: CustomerBill | null;
}
