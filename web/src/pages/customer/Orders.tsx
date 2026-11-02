import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '../../components/ui';
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
    return <EmptyState emoji="📦" title={t('orders.empty_title')} text={t('orders.empty_text')} action={<Link to="/shop"><Button size="lg">{t('cart.start')}</Button></Link>} />;
  }
  const active = orders.filter((o) => isActive(o.status));
  const past = orders.filter((o) => !isActive(o.status));
  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold tracking-tight">{t('orders.title')}</h1>
      {active.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{t('orders.in_progress')}</h2>
          <div className="mb-6 space-y-2.5">{active.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </>
      )}
      {past.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">{t('orders.past')}</h2>
          <div className="space-y-2.5">{past.map((o) => <OrderRow key={o.id} o={o} />)}</div>
        </>
      )}
    </div>
  );
}

function OrderRow({ o }: { o: OrderSummary }) {
  const meta = STATUS_META[o.status];
  const { t } = useT();
  return (
    <Link to={`/orders/${o.id}`}>
      <Card className="flex items-center gap-3 transition active:scale-[0.99]">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 text-2xl">{meta.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold">{o.code}</span>
            <Badge className={meta.tone}>{t(`status.${o.status}`)}</Badge>
          </div>
          <div className="truncate text-sm text-muted">
            {o.preview?.join(' ')} · {t('orders.items', { n: o.itemCount ?? 0 })} · {o.fulfillmentType === 'delivery' ? t('co.delivery') : t('co.pickup')}
          </div>
          <div className="text-xs text-muted">{timeAgo(o.placedAt)}</div>
        </div>
        <div className="text-right">
          <div className="font-extrabold">{money(o.totalCents)}</div>
          {o.pointsAwarded > 0 && o.pointsReversed === 0 && <div className="text-xs font-semibold text-amber-600">+{o.pointsAwarded} ⭐</div>}
        </div>
      </Card>
    </Link>
  );
}
