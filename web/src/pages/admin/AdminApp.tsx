import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Avatar, Badge, Button, cx, EmptyState } from '../../components/ui';
import { api } from '../../lib/api';
import { useShop } from '../../lib/queries';
import { isStaff, useSession } from '../../lib/session';
import { inTelegram, useTelegramBackButton } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import { CustomerDetail, CustomersPage } from './CustomersPage';
import { InsightsPage } from './InsightsPage';
import { LoyaltyPage } from './LoyaltyPage';
import { OrderDetailPage, OrdersPage } from './OrdersPage';
import { ProductsPage } from './ProductsPage';
import { QrPage } from './QrPage';
import { SettingsPage } from './SettingsPage';

const NAV = [
  { to: '/admin/orders', label: 'Orders', icon: '🧾' },
  { to: '/admin/products', label: 'Catalog', icon: '🏷️' },
  { to: '/admin/customers', label: 'Customers', icon: '👥' },
  { to: '/admin/loyalty', label: 'Loyalty', icon: '🎁' },
  { to: '/admin/insights', label: 'Insights', icon: '📊' },
  { to: '/admin/qr', label: 'QR codes', icon: '🔳' },
  { to: '/admin/settings', label: 'Settings', icon: '⚙️' },
];

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* audio not available */
  }
}

/** Polls for new orders the shop can act on (paid QR orders and cash orders) and raises an alert. */
function useNewOrderAlerts(sound: boolean) {
  const qc = useQueryClient();
  const last = useRef<number | null>(null);
  const pulse = useQuery({
    queryKey: ['admin', 'pulse'],
    queryFn: () => api<{ latestActionableId: number; newCount: number; activeCount: number; awaitingPaymentCount: number }>('/admin/orders/pulse'),
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const d = pulse.data;
    if (!d) return;
    if (last.current != null && d.latestActionableId > last.current) {
      toast(`🆕 New order #${String(d.latestActionableId).padStart(4, '0')} received!`, 'success');
      if (sound) beep();
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    }
    last.current = d.latestActionableId;
  }, [pulse.data, sound, qc]);
  useEffect(() => {
    const n = pulse.data?.newCount ?? 0;
    document.title = `${n ? `(${n}) ` : ''}Dashboard`;
  }, [pulse.data?.newCount]);
  return pulse.data;
}

export default function AdminApp() {
  const { user } = useSession();
  const shop = useShop();
  const location = useLocation();
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem('sm-admin-sound') === '1';
    } catch {
      return false;
    }
  });
  const pulse = useNewOrderAlerts(sound);
  useTelegramBackButton(/^\/admin\/(orders|customers)\/\d+/.test(location.pathname) ? () => window.history.back() : null);

  if (!isStaff(user)) {
    return (
      <EmptyState emoji="🔐" title="Staff only" text="This dashboard is for shop staff. Ask the shop admin to give your account staff access." action={<Link to="/"><Button>Back to the shop</Button></Link>} />
    );
  }

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem('sm-admin-sound', next ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (next) beep();
  };

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">🧺</span>
          <div>
            <div className="font-extrabold leading-tight">{shop.data?.shopName ?? 'Shop'}</div>
            <div className="text-xs text-muted">Seller dashboard</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('flex items-center justify-between rounded-xl px-3 py-2.5 font-semibold transition', isActive ? 'bg-brand/12 text-brand' : 'text-ink/80 hover:bg-surface-2')}>
              <span>{n.icon} {n.label}</span>
              {n.to === '/admin/orders' && (pulse?.newCount ?? 0) > 0 && <Badge className="bg-orange-500 text-white">{pulse!.newCount}</Badge>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <button onClick={toggleSound} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2">{sound ? '🔔 Alert sound on' : '🔕 Alert sound off'}</button>
          <Link to="/" className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-surface-2">🛒 Open customer app</Link>
          <div className="flex items-center gap-2 px-3 pt-1">
            <Avatar name={user!.firstName} url={user!.photoUrl} size={32} />
            <div className="min-w-0 text-sm">
              <div className="truncate font-semibold">{user!.firstName}</div>
              <div className="text-xs capitalize text-muted">{user!.role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Top bar (mobile / Telegram) */}
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="font-extrabold">🧺 {shop.data?.shopName} <span className="font-normal text-muted">· staff</span></div>
          <div className="flex items-center gap-1">
            <button onClick={toggleSound} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2" aria-label="Toggle alert sound">{sound ? '🔔' : '🔕'}</button>
            {!inTelegram && <Link to="/" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2" aria-label="Customer app">🛒</Link>}
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold', isActive ? 'bg-ink text-bg' : 'bg-surface-2')}>
              {n.icon} {n.label}
              {n.to === '/admin/orders' && (pulse?.newCount ?? 0) > 0 && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-xs text-white">{pulse!.newCount}</span>}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 lg:p-8">
        {shop.data?.notificationsSimulated && (
          <div className="no-print mb-4 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            🧪 <b>Telegram notifications are SIMULATED</b> — no bot token configured. Messages are logged on the server and listed on each order.
          </div>
        )}
        <Routes>
          <Route index element={<Navigate to="orders" replace />} />
          <Route path="login" element={<Navigate to="/admin/orders" replace />} />
          <Route path="orders" element={<OrdersPage counts={pulse} />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="loyalty" element={<LoyaltyPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="qr" element={<QrPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="orders" replace />} />
        </Routes>
      </main>
    </div>
  );
}
