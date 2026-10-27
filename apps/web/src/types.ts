export type Role = 'owner' | 'manager' | 'cashier';
export type PaymentMethod = 'cash' | 'promptpay' | 'card';

export interface Branch {
  id: string;
  code: string;
  name: string;
  promptpayId: string | null;
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
  status: 'active' | 'void';
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
  byMethod: { method: PaymentMethod; amountSatang: number; count: number }[];
  topProducts: { name: string; qty: number; salesSatang: number }[];
  hourly: { hour: number; orders: number; salesSatang: number }[];
}
export interface StaffUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}
