import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Avatar, Badge, Button, cx, EmptyState } from '../../components/ui';
import { api } from '../../lib/api';
import { orderCode } from '../../lib/format';
import { translate, useT, type TKey } from '../../lib/i18n';
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

const NAV: { to: string; label: TKey; icon: string }[] = [
  { to: '/admin/orders', label: 'ad.nav_orders', icon: '🧾' },
  { to: '/admin/products', label: 'ad.nav_catalog', icon: '🏷️' },
  { to: '/admin/customers', label: 'ad.nav_customers', icon: '👥' },
  { to: '/admin/loyalty', label: 'ad.nav_loyalty', icon: '🎁' },
  { to: '/admin/insights', label: 'ad.nav_insights', icon: '📊' },
  { to: '/admin/qr', label: 'ad.nav_qr', icon: '🔳' },
  { to: '/admin/settings', label: 'ad.nav_settings', icon: '⚙️' },
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

/** Polls for new orders and raises an alert (toast, optional sound, title badge). */
function useNewOrderAlerts(sound: boolean) {
  const qc = useQueryClient();
  const last = useRef<number | null>(null);
  const pulse = useQuery({
    queryKey: ['admin', 'pulse'],
    queryFn: () => api<{ latestOrderId: number; newCount: number; activeCount: number }>('/admin/orders/pulse'),
    refetchInterval: 8000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    const d = pulse.data;
    if (!d) return;
    if (last.current != null && d.latestOrderId > last.current) {
      toast(translate('ad.new_order_toast', { code: orderCode(d.latestOrderId) }), 'success');
      if (sound) beep();
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    }
    last.current = d.latestOrderId;
  }, [pulse.data, sound, qc]);
  useEffect(() => {
    const n = pulse.data?.newCount ?? 0;
    document.title = `${n ? `(${n}) ` : ''}${translate('ad.title')}`;
  }, [pulse.data?.newCount]);
  return pulse.data;
}

export default function AdminApp() {
  const { user } = useSession();
  const { t } = useT();
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
    return <EmptyState emoji="🔐" title={t('ad.staff_only_title')} text={t('ad.staff_only_text')} action={<Link to="/"><Button>{t('ad.back_to_shop')}</Button></Link>} />;
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
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="text-2xl">🧺</span>
          <div>
            <div className="font-extrabold leading-tight">{shop.data?.shopName ?? 'mart25'}</div>
            <div className="text-xs text-muted">{t('ad.seller_dashboard')}</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('flex items-center justify-between rounded-xl px-3 py-2.5 font-semibold transition', isActive ? 'bg-brand/12 text-brand' : 'text-ink/80 hover:bg-surface-2')}>
              <span>
                {n.icon} {t(n.label)}
              </span>
              {n.to === '/admin/orders' && (pulse?.newCount ?? 0) > 0 && <Badge className="bg-orange-500 text-white">{pulse!.newCount}</Badge>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <LanguageSwitch className="ml-1" />
          <button onClick={toggleSound} className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-surface-2">
            {sound ? t('ad.sound_on') : t('ad.sound_off')}
          </button>
          <Link to="/" className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-surface-2">
            {t('ad.customer_app')}
          </Link>
          <div className="flex items-center gap-2 px-3 pt-1">
            <Avatar name={user!.firstName} url={user!.photoUrl} size={32} />
            <div className="min-w-0 text-sm">
              <div className="truncate font-semibold">{user!.firstName}</div>
              <div className="text-xs text-muted">{t(`ad.role_${user!.role}` as TKey)}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Top bar (mobile / Telegram) */}
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <div className="truncate font-extrabold">🧺 {shop.data?.shopName}</div>
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitch />
            <button onClick={toggleSound} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2" aria-label={t('ad.toggle_sound')}>
              {sound ? '🔔' : '🔕'}
            </button>
            {!inTelegram && (
              <Link to="/" className="grid h-9 w-9 place-items-center rounded-full bg-surface-2" aria-label={t('ad.customer_app')}>
                🛒
              </Link>
            )}
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-2">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold', isActive ? 'bg-ink text-bg' : 'bg-surface-2')}>
              {n.icon} {t(n.label)}
              {n.to === '/admin/orders' && (pulse?.newCount ?? 0) > 0 && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-xs text-white">{pulse!.newCount}</span>}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 lg:p-8">
        {shop.data?.notificationsSimulated && (
          <div className="no-print mb-4 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            🧪 <b>{t('ad.simulated_b')}</b>
            {t('ad.simulated')}
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
