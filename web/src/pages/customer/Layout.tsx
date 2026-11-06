import { ChevronRight, Gift, House, LayoutGrid, ReceiptText, ShoppingBasket, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cartCount, cartSubtotal, useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';
import { useHome } from '../../lib/queries';
import { useTelegramBackButton } from '../../lib/telegram';
import { cx } from '../../components/ui';

// Shopping first: Shop and the Basket (with its item count) are always one tap away.
// Profile opens from the avatar on Home (and links to Rewards history too).
const TABS: { to: string; label: TKey; icon: LucideIcon; end?: boolean }[] = [
  { to: '/', label: 'nav.home', icon: House, end: true },
  { to: '/shop', label: 'nav.shop', icon: LayoutGrid },
  { to: '/cart', label: 'nav.cart', icon: ShoppingBasket },
  { to: '/rewards', label: 'nav.rewards', icon: Gift },
  { to: '/orders', label: 'nav.orders', icon: ReceiptText },
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
          className="animate-rise fixed inset-x-4 bottom-[76px] z-30 mx-auto flex max-w-[calc(36rem-2rem)] items-center justify-between rounded-xl bg-brand px-4 py-3 font-semibold text-brand-ink shadow-lg shadow-black/10"
        >
          <span className="flex items-center gap-2.5">
            <span key={bump} className="animate-pop grid h-7 min-w-7 place-items-center rounded-full bg-white/20 px-1.5 text-sm font-bold">
              {count}
            </span>
            {t('layout.view_basket')}
          </span>
          <span className="flex items-center gap-1 font-bold">
            {money(cartSubtotal(lines))}
            <ChevronRight className="h-5 w-5" />
          </span>
        </button>
      )}

      {!isFlow && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface" aria-label="Main">
          <div className="mx-auto grid max-w-xl grid-cols-5">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cx('relative flex flex-col items-center gap-0.5 pb-2 pt-2 text-[11px] font-medium transition', isActive ? 'font-semibold text-brand' : 'text-muted')
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cx('grid h-7 w-12 place-items-center rounded-full transition', isActive && 'bg-brand/10')}>
                      <tab.icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.7} aria-hidden />
                    </span>
                    <span className="max-w-full truncate px-0.5">{t(tab.label)}</span>
                    {tab.to === '/cart' && count > 0 && (
                      <span
                        key={bump}
                        className="animate-pop absolute left-1/2 top-1 ml-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface"
                        aria-label={`${count}`}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                    {tab.to === '/orders' && (home.data?.activeOrders ?? 0) > 0 && (
                      <span className="absolute left-1/2 top-2 ml-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-surface" />
                    )}
                    {tab.to === '/rewards' && (home.data?.unseen.length ?? 0) > 0 && (
                      <span className="absolute left-1/2 top-2 ml-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-surface" />
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
