import { Link, useNavigate } from 'react-router-dom';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard';
import { RewardCelebration } from '../../components/RewardCelebration';
import { Avatar, Badge, CountUp, ErrorState, ProgressBar, SectionTitle, Skeleton } from '../../components/ui';
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
  const colorOf = (id: number) => cats.data?.find((c) => c.id === id)?.color;

  return (
    <div>
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{greeting()},</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{user?.firstName} 👋</h1>
        </div>
        <Link to="/profile" aria-label="Profile">
          <Avatar name={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`} url={user?.photoUrl} />
        </Link>
      </header>

      {/* Points card */}
      {home.isLoading ? (
        <Skeleton className="mt-5 h-40 rounded-3xl" />
      ) : home.error ? (
        <ErrorState error={home.error} onRetry={() => home.refetch()} />
      ) : home.data ? (
        <Link
          to="/rewards"
          className="mt-5 block rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 p-5 text-amber-950 shadow-lg shadow-orange-900/10 transition active:scale-[0.99]"
        >
          <div className="flex items-center justify-between">
            <Badge className="bg-white/40">
              {home.data.level.emoji} {home.data.level.name}
            </Badge>
            {home.data.availableRewards > 0 && <Badge className="bg-white/60">{t('home.ready', { n: home.data.availableRewards })}</Badge>}
          </div>
          <div className="mt-2 text-4xl font-black tabular-nums">
            <CountUp value={home.data.balance} /> <span className="text-lg font-bold">{t('common.points')}</span>
          </div>
          {home.data.progress ? (
            <>
              <ProgressBar percent={home.data.progress.percent} className="mt-3 bg-white/40" tone="brand" />
              <p className="mt-2 text-sm font-semibold">
                {t('home.points_away', { n: home.data.progress.remaining, reward: `${home.data.progress.emoji} ${home.data.progress.title}` })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm font-semibold">{t('home.all_unlocked')}</p>
          )}
        </Link>
      ) : null}

      {(home.data?.activeOrders ?? 0) > 0 && (
        <Link to="/orders" className="mt-3 flex items-center justify-between rounded-2xl bg-sky-100 px-4 py-3 font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-200">
          <span>{t('home.in_progress', { n: home.data!.activeOrders })}</span>
          <span>{t('home.track')}</span>
        </Link>
      )}

      {/* Search */}
      <button
        onClick={() => navigate('/shop?focus=1')}
        className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left text-muted ring-1 ring-line/60"
      >
        <span>🔍</span> {t('home.search')}
      </button>

      {shop.data?.freeDeliveryMinCents != null && shop.data.deliveryEnabled && (
        <p className="mt-3 text-center text-sm text-muted">{t('home.free_delivery', { amount: money(shop.data.freeDeliveryMinCents) })}</p>
      )}

      {/* Categories */}
      <SectionTitle action={<Link to="/shop" className="text-sm font-semibold text-brand">{t('common.see_all')}</Link>}>{t('home.aisles')}</SectionTitle>
      <div className="grid grid-cols-4 gap-2.5">
        {cats.isLoading
          ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)
          : cats.data?.map((c) => (
              <Link key={c.id} to={`/shop?category=${c.id}`} className="flex flex-col items-center gap-1.5 rounded-2xl p-2 text-center transition active:scale-95" style={{ background: `${c.color}1f` }}>
                <span className="text-3xl">{c.emoji}</span>
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight">{c.name}</span>
              </Link>
            ))}
      </div>

      {/* Promotions */}
      {(promos.isLoading || (promos.data?.length ?? 0) > 0) && (
        <>
          <SectionTitle action={<Link to="/shop?promo=1" className="text-sm font-semibold text-brand">{t('home.all_deals')}</Link>}>{t('home.on_sale')}</SectionTitle>
          {promos.isLoading ? (
            <ProductGridSkeleton n={2} />
          ) : (
            <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1">
              {promos.data!.map((p) => (
                <div key={p.id} className="w-40 shrink-0 snap-start">
                  <ProductCard p={p} color={colorOf(p.categoryId)} />
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {featured.data!.map((p) => (
            <ProductCard key={p.id} p={p} color={colorOf(p.categoryId)} />
          ))}
        </div>
      )}

      {home.data && <RewardCelebration unseen={home.data.unseen} />}
    </div>
  );
}
