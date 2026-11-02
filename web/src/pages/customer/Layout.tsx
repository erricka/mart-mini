import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cartCount, cartSubtotal, useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';
import { useHome } from '../../lib/queries';
import { useTelegramBackButton } from '../../lib/telegram';
import { cx } from '../../components/ui';

const TABS: { to: string; label: TKey; icon: string; end?: boolean }[] = [
  { to: '/', label: 'nav.home', icon: '🏠', end: true },
  { to: '/shop', label: 'nav.shop', icon: '🛒' },
  { to: '/rewards', label: 'nav.rewards', icon: '🎁' },
  { to: '/orders', label: 'nav.orders', icon: '📦' },
  { to: '/profile', label: 'nav.profile', icon: '🙂' },
];
const TAB_PATHS = new Set(TABS.map((t) => t.to));
const HIDE_CART_BAR = ['/cart', '/checkout'];

export function CustomerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const lines = useCart((s) => s.lines);
  const bump = useCart((s) => s.bump);
  const home = useHome();
  const count = cartCount(lines);
  const isTab = TAB_PATHS.has(location.pathname);
  const isFlow = location.pathname === '/checkout';

  // Native Telegram back button on inner screens.
  useTelegramBackButton(
    isTab
      ? null
      : () => {
          if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
          else navigate('/');
        },
  );

  const showCartBar = count > 0 && !HIDE_CART_BAR.includes(location.pathname) && !isFlow;

  return (
    <div className="mx-auto min-h-screen max-w-xl">
      <main className={cx('px-4 pt-4', isFlow ? 'pb-40' : showCartBar || location.pathname === '/cart' ? 'pb-44' : 'pb-28')}>
        <Outlet />
      </main>

      {showCartBar && (
        <button
          onClick={() => navigate('/cart')}
          className="animate-rise fixed inset-x-4 bottom-[84px] z-30 mx-auto flex max-w-[calc(36rem-2rem)] items-center justify-between rounded-2xl bg-brand px-4 py-3.5 font-bold text-brand-ink shadow-xl shadow-green-900/20"
        >
          <span className="flex items-center gap-2">
            <span key={bump} className="animate-pop grid h-8 min-w-8 place-items-center rounded-full bg-white/25 px-2 text-sm">
              {count}
            </span>
            {t('layout.view_basket')}
          </span>
          <span>{money(cartSubtotal(lines))} →</span>
        </button>
      )}

      {!isFlow && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur" aria-label="Main">
          <div className="mx-auto grid max-w-xl grid-cols-5">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cx('relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition', isActive ? 'text-brand' : 'text-muted')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cx('text-[22px] leading-none transition', isActive ? 'scale-110' : 'grayscale-[.6] opacity-80')}>{tab.icon}</span>
                    <span className="max-w-full truncate px-0.5">{t(tab.label)}</span>
                    {tab.to === '/orders' && (home.data?.activeOrders ?? 0) > 0 && (
                      <span className="absolute right-[22%] top-1.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-surface" />
                    )}
                    {tab.to === '/rewards' && (home.data?.unseen.length ?? 0) > 0 && (
                      <span className="absolute right-[22%] top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-surface" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
