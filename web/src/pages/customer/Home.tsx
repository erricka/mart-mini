import { ChevronRight, Package, Search, Star } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard';
import { RewardCelebration } from '../../components/RewardCelebration';
import { Avatar, CountUp, ErrorState, ProgressBar, SectionTitle, Skeleton } from '../../components/ui';
import { greeting, money } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useCategories, useHome, useProducts, useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';

export function Home() {
  const { user } = useSession();
  const { t } = useT();
  const navigate = useNavigate();
  const home = useHome();
  const shop = useShop();
  const cats = useCategories();
  const promos = useProducts({ promo: true, limit: 10 });
  const featured = useProducts({ featured: true, limit: 10 });
  const seeAll = (to: string, label: string) => (
    <Link to={to} className="flex items-center text-sm font-semibold text-brand">
      {label}
      <ChevronRight className="h-4 w-4" />
    </Link>
  );

  return (
    <div>
      {/* Green header: greeting + search */}
      <div className="-mx-4 -mt-4 rounded-b-3xl bg-brand px-4 pb-5 pt-4 text-brand-ink">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm opacity-85">{greeting()}</p>
            <h1 className="truncate text-[22px] font-bold">{user?.firstName}</h1>
          </div>
          <Link to="/profile" aria-label="Profile" className="rounded-full bg-white">
            <Avatar name={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} url={user?.photoUrl} size={40} />
          </Link>
        </header>
        <button
          onClick={() => navigate('/shop?focus=1')}
          className="mt-4 flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3 text-left text-muted shadow-sm"
        >
          <Search className="h-5 w-5 text-brand" />
          <span className="truncate">{t('home.search')}</span>
        </button>
      </div>

      {/* Points */}
      {home.isLoading ? (
        <Skeleton className="mt-4 h-[116px] rounded-2xl" />
      ) : home.error ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : home.data ? (
        <Link to="/rewards" className="mt-4 block rounded-2xl bg-surface ring-1 ring-line p-4 transition active:scale-[0.99]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-500 dark:bg-amber-500/10">
                <Star className="h-5 w-5 fill-current" />
              </span>
              <div>
                <div className="text-xl font-bold leading-none tabular-nums">
                  <CountUp value={home.data.balance} /> <span className="text-sm font-medium text-muted">{t('common.points')}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {home.data.level.name}
                  {home.data.availableRewards > 0 && <span className="font-semibold text-brand"> · {t('home.ready', { n: home.data.availableRewards })}</span>}
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted" />
          </div>
          {home.data.progress ? (
            <>
              <ProgressBar percent={home.data.progress.percent} className="mt-3.5" tone="sun" />
              <p className="mt-2 text-xs text-muted">{t('home.points_away', { n: home.data.progress.remaining, reward: home.data.progress.title })}</p>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted">{t('home.all_unlocked')}</p>
          )}
        </Link>
      ) : null}

      {(home.data?.activeOrders ?? 0) > 0 && (
        <Link to="/orders" className="mt-3 flex items-center gap-3 rounded-2xl bg-surface ring-1 ring-line p-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand/10 text-brand">
            <Package className="h-5 w-5" />
          </span>
          <span className="flex-1 text-sm font-semibold">{t('home.in_progress', { n: home.data!.activeOrders })}</span>
          <span className="flex items-center text-sm font-semibold text-brand">
            {t('home.track')}
            <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      )}

      {shop.data?.freeDeliveryMinCents != null && shop.data.deliveryEnabled && (
        <p className="mt-3 text-center text-sm text-muted">{t('home.free_delivery', { amount: money(shop.data.freeDeliveryMinCents) })}</p>
      )}

      {/* Categories */}
      <SectionTitle action={seeAll('/shop', t('common.see_all'))}>{t('home.aisles')}</SectionTitle>
      <div className="grid grid-cols-4 gap-x-2 gap-y-4">
        {cats.isLoading
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="mx-auto h-14 w-14 rounded-full" />)
          : cats.data?.map((c) => (
              <Link key={c.id} to={`/shop?category=${c.id}`} className="flex flex-col items-center gap-1.5 text-center transition active:scale-95">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-[28px]">{c.emoji}</span>
                <span className="line-clamp-2 text-xs leading-tight">{c.name}</span>
              </Link>
            ))}
      </div>

      {/* Promotions */}
      {(promos.isLoading || (promos.data?.length ?? 0) > 0) && (
        <>
          <SectionTitle action={seeAll('/shop?promo=1', t('home.all_deals'))}>{t('home.on_sale')}</SectionTitle>
          {promos.isLoading ? (
            <ProductGridSkeleton n={2} />
          ) : (
            <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
              {promos.data!.map((p) => (
                <div key={p.id} className="w-[150px] shrink-0 snap-start">
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <SectionTitle>{t('home.popular')}</SectionTitle>
      {featured.isLoading ? (
        <ProductGridSkeleton n={4} />
      ) : featured.error ? (
        <ErrorState error={featured.error} onRetry={() => featured.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {featured.data!.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {home.data && <RewardCelebration unseen={home.data.unseen} />}
    </div>
  );
}
