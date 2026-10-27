import { BarChart3, ChefHat, Clock, CloudOff, LayoutGrid, ListOrdered, LogOut, Package, RefreshCw, Settings, ShoppingCart, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useOnline } from '../hooks/useOnline';
import { usePending } from '../hooks/usePending';
import { flushQueue, useSync } from '../lib/offline';
import { isManager, useAuth } from '../store/auth';
import { useCart } from '../store/cart';
import { cn } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  manager?: boolean;
}
const NAV: NavItem[] = [
  { to: '/', label: 'ขาย', icon: ShoppingCart },
  { to: '/tables', label: 'โต๊ะ', icon: LayoutGrid },
  { to: '/kitchen', label: 'ครัว', icon: ChefHat },
  { to: '/queue', label: 'คิว', icon: ListOrdered },
  { to: '/shift', label: 'กะ', icon: Clock },
  { to: '/inventory', label: 'คลัง', icon: Package, manager: true },
  { to: '/reports', label: 'รายงาน', icon: BarChart3, manager: true },
  { to: '/manage', label: 'จัดการ', icon: Settings, manager: true },
];

export function Layout() {
  const { user, branch, logout } = useAuth();
  const online = useOnline();
  const { pending: queued, failed, syncing } = useSync();
  const nav = useNavigate();
  const pending = usePending();
  // ออกจากระบบเอง → ล้างตะกร้า ไม่ให้รายการค้างไปถึงพนักงานคนถัดไป (คิวบิลออฟไลน์ยังเก็บไว้ส่งต่อ)
  const signOut = () => {
    useCart.getState().clear();
    logout();
  };
  const items = NAV.filter((n) => !n.manager || isManager(user?.role));

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* แถบนำทางด้านซ้าย (แท็บเล็ต/เดสก์ท็อป) */}
      <aside className="hidden w-20 shrink-0 flex-col items-center gap-1 bg-stone-900 py-3 md:flex">
        <img src="/icon.svg" alt="" className="mb-3 h-10 w-10" />
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs',
                isActive ? 'bg-brand-700 text-white' : 'text-stone-400 hover:bg-stone-800 hover:text-white',
              )
            }
          >
            <span className="relative">
              <n.icon size={22} />
              {n.to === '/tables' && pending.count > 0 && <Dot n={pending.count} />}
            </span>
            {n.label}
          </NavLink>
        ))}
        <button
          onClick={() => {
            signOut();
            nav('/login');
          }}
          className="mt-auto flex w-16 flex-col items-center gap-1 rounded-xl py-2.5 text-xs text-stone-400 hover:bg-stone-800 hover:text-white"
        >
          <LogOut size={22} />
          ออก
        </button>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-4">
          <div className="min-w-0 truncate font-semibold">{branch?.name}</div>
          <div className="truncate text-sm text-stone-500">· {user?.name}</div>
          <div className="ml-auto flex items-center gap-2">
            {pending.count > 0 && (
              <button onClick={() => nav('/tables')} className="shrink-0 whitespace-nowrap rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
                QR รอยืนยัน {pending.count}
              </button>
            )}
            {(queued > 0 || failed > 0) && (
              <button
                onClick={() => (failed > 0 ? nav('/sync') : void flushQueue())}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                  failed > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800',
                )}
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {failed > 0 ? `ต้องตรวจสอบ ${failed}` : `รอส่ง ${queued} บิล`}
              </button>
            )}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                online ? 'bg-green-100 text-green-800' : 'bg-stone-800 text-white',
              )}
            >
              {online ? <span className="h-2 w-2 rounded-full bg-green-600" /> : <CloudOff size={14} />}
              {online ? 'ออนไลน์' : 'ออฟไลน์'}
            </span>
            <button
              onClick={() => {
                signOut();
                nav('/login');
              }}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 md:hidden"
              aria-label="ออกจากระบบ"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>

        {/* แถบนำทางด้านล่าง (มือถือ) */}
        <nav className="flex shrink-0 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-brand-700' : 'text-stone-500')}
            >
              <span className="relative">
                <n.icon size={20} />
                {n.to === '/tables' && pending.count > 0 && <Dot n={pending.count} />}
              </span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Dot({ n }: { n: number }) {
  return (
    <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white" aria-label={`รอยืนยัน ${n} รายการ`}>
      {n}
    </span>
  );
}
