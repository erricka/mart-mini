import { ChevronRight, ReceiptText, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, cx, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { money, timeAgo } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useOrders } from '../../lib/queries';
import { isActive, STATUS_META } from '../../lib/status';
import type { OrderSummary } from '../../lib/types';

export function Orders() {
  const q = useOrders();
  const { t } = useT();
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-40" />{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const orders = q.data!.orders;
  if (!orders.length) {
    return <EmptyState emoji={<ReceiptText className="h-9 w-9" strokeWidth={1.5} />} title={t('orders.empty_title')} text={t('orders.empty_text')} action={<Link to="/shop"><Button size="lg">{t('cart.start')}</Button></Link>} />;
  }
  const active = orders.filter((o) => isActive(o.status));
  const past = orders.filter((o) => !isActive(o.status));
  return (
    <div>
      <h1 className="mb-4 text-[22px] font-bold">{t('orders.title')}</h1>
      {active.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">{t('orders.in_progress')}</h2>
          <div className="mb-6 divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">{active.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </>
      )}
      {past.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">{t('orders.past')}</h2>
          <div className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">{past.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </>
      )}
    </div>
  );
}

function OrderRow({ o }: { o: OrderSummary }) {
  const meta = STATUS_META[o.status];
  const { t } = useT();
  return (
    <Link to={`/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3.5 transition active:bg-surface-2">
      <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-full', meta.tone)}>
        <meta.icon className="h-5 w-5" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{t(`status.${o.status}`)}</span>
          <span className="shrink-0 font-semibold tabular-nums">{money(o.totalCents)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-muted">
          <span className="truncate">
            {o.code} · {t('orders.items', { n: o.itemCount ?? 0 })} · {timeAgo(o.placedAt)}
          </span>
          {o.pointsAwarded > 0 && o.pointsReversed === 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-xs">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />+{o.pointsAwarded}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
    </Link>
  );
}
