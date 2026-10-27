import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toast } from './components/Toast';
import { api } from './lib/api';
import { startAutoSync } from './lib/offline';
import { CustomerOrderPage } from './pages/CustomerOrderPage';
import { KitchenPage } from './pages/KitchenPage';
import { QueuePage } from './pages/QueuePage';
import { QueueBoardPage, QueueJoinPage, QueueTicketPage } from './pages/QueuePublicPages';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { ManagePage } from './pages/ManagePage';
import { OrderPage } from './pages/OrderPage';
import { PosPage } from './pages/PosPage';
import { ReportsPage } from './pages/ReportsPage';
import { ShiftPage } from './pages/ShiftPage';
import { SyncPage } from './pages/SyncPage';
import { TablesPage } from './pages/TablesPage';
import { isManager, useAuth } from './store/auth';
import type { Branch, SessionUser } from './types';

function RequireAuth({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.token);
  return token ? children : <Navigate to="/login" replace />;
}
function RequireManager({ children }: { children: ReactNode }) {
  const role = useAuth((s) => s.user?.role);
  return isManager(role) ? children : <Navigate to="/" replace />;
}

export function App() {
  useEffect(() => startAutoSync(), []);
  useEffect(() => {
    // ดึงข้อมูลผู้ใช้/สาขาล่าสุดเมื่อเปิดแอป (สิทธิ์หรือ PromptPay อาจถูกแก้จากเครื่องอื่น)
    // ถ้าโทเค็นถูกเพิกถอน api() จะ logout ให้เอง; ถ้าออฟไลน์ก็ใช้ข้อมูลเดิมต่อ
    if (!useAuth.getState().token) return;
    api<{ user: SessionUser; branch: Branch }>('/auth/me')
      .then((r) => {
        useAuth.getState().setUser(r.user);
        useAuth.getState().setBranch(r.branch);
      })
      .catch(() => {});
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* หน้าสาธารณะสำหรับลูกค้า (ไม่ต้องล็อกอิน) */}
        <Route path="/t/:token" element={<CustomerOrderPage />} />
        <Route path="/q/ticket/:token" element={<QueueTicketPage />} />
        <Route path="/q/:branchCode" element={<QueueJoinPage />} />
        <Route path="/board/:branchCode" element={<QueueBoardPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<PosPage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="orders/:id" element={<OrderPage />} />
          <Route path="kitchen" element={<KitchenPage />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="shift" element={<ShiftPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="reports" element={<RequireManager><ReportsPage /></RequireManager>} />
          <Route path="inventory" element={<RequireManager><InventoryPage /></RequireManager>} />
          <Route path="manage" element={<RequireManager><ManagePage /></RequireManager>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast />
    </BrowserRouter>
  );
}
