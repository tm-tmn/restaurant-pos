import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toast } from './components/Toast';
import { startAutoSync } from './lib/offline';
import { LoginPage } from './pages/LoginPage';
import { ManagePage } from './pages/ManagePage';
import { OrderPage } from './pages/OrderPage';
import { PosPage } from './pages/PosPage';
import { ReportsPage } from './pages/ReportsPage';
import { ShiftPage } from './pages/ShiftPage';
import { SyncPage } from './pages/SyncPage';
import { TablesPage } from './pages/TablesPage';
import { isManager, useAuth } from './store/auth';

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
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
          <Route path="shift" element={<ShiftPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="reports" element={<RequireManager><ReportsPage /></RequireManager>} />
          <Route path="manage" element={<RequireManager><ManagePage /></RequireManager>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toast />
    </BrowserRouter>
  );
}
