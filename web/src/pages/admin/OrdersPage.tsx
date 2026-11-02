import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { Avatar, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, PageLoader, Sheet, Skeleton, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, money, timeAgo } from '../../lib/format';
import { translate, useT, type TKey } from '../../lib/i18n';
import { PAYMENT_TONE, STATUS_META } from '../../lib/status';
import { toast } from '../../lib/toast';
import type { OrderStatus, OrderSummary, PaymentStatus, StaffOrderDetail } from '../../lib/types';
import { PageHeader } from './common';

type View = 'active' | 'placed' | 'completed' | 'cancelled' | 'all';
type AdminOrder = OrderSummary & { username: string | null; city: string | null; discountLabel: string | null; hasNote: boolean };

const statusLabel = (s: OrderStatus) => translate(`status.${s}` as TKey);
const nextLabel = (s: OrderStatus) => translate(`ao.next_${s}` as TKey);

function kindLabel(kind: string) {
  if (kind.startsWith('order_') && `status.${kind.slice(6)}` in { 'status.confirmed': 1, 'status.preparing': 1, 'status.out_for_delivery': 1, 'status.delivered': 1, 'status.ready_for_pickup': 1, 'status.collected': 1, 'status.cancelled': 1 }) {
    return statusLabel(kind.slice(6) as OrderStatus);
  }
  const key = `ao.kind_${kind}` as TKey;
  const label = translate(key);
  return label === key ? kind.replace(/_/g, ' ') : label;
}

function useStatusMutation(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: OrderStatus; reason?: string; note?: string }) => api<{ order: StaffOrderDetail; points: number; changed: boolean }>(`/admin/orders/${id}/status`, { body }),
    onSuccess: (r, v) => {
      qc.setQueryData(['admin', 'order', id], r.order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'pulse'] });
      toast(
        r.points ? translate('ao.status_points_toast', { status: statusLabel(v.status), n: r.points }) : translate('ao.status_toast', { code: r.order.code, status: statusLabel(v.status) }),
        'success',
      );
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

export function OrdersPage({ counts }: { counts?: { newCount: number; activeCount: number } }) {
  const { t } = useT();
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const params = new URLSearchParams(view === 'placed' ? { status: 'placed' } : { view });
  if (q.trim()) params.set('q', q.trim());
  const list = useQuery({
    queryKey: ['admin', 'orders', view, q.trim()],
    queryFn: () => api<{ orders: AdminOrder[]; counts: Partial<Record<OrderStatus, number>> }>(`/admin/orders?${params}`),
    refetchInterval: 10_000,
    placeholderData: (p) => p,
  });

  const tabs: { id: View; label: string; n?: number }[] = [
    { id: 'active', label: t('ao.tab_active'), n: counts?.activeCount },
    { id: 'placed', label: t('ao.tab_new'), n: counts?.newCount },
    { id: 'completed', label: t('ao.tab_completed') },
    { id: 'cancelled', label: t('ao.tab_cancelled') },
    { id: 'all', label: t('ao.tab_all') },
  ];
  const quiet = view === 'active' || view === 'placed';

  return (
    <div>
      <PageHeader title={t('ao.title')} subtitle={t('ao.subtitle')} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setView(tab.id)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold transition', view === tab.id ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
            {tab.label}
            {tab.n ? <span className={cx('ml-1.5 rounded-full px-1.5 text-xs', tab.id === 'placed' ? 'bg-orange-500 text-white' : 'bg-surface-2 text-ink')}>{tab.n}</span> : null}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ao.search')} className="ml-auto max-w-64 py-2" />
      </div>

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.orders.length === 0 ? (
        <EmptyState emoji={quiet ? '☕' : '🗂️'} title={quiet ? t('ao.caught_up') : t('ao.none')} text={view === 'active' ? t('ao.caught_up_text') : undefined} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  {[t('ao.col_order'), t('ao.col_customer'), t('ao.col_type'), t('ao.col_items'), t('ao.col_total'), t('ao.col_payment'), t('ao.col_status'), ''].map((h, i) => (
                    <th key={i} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.orders.map((o) => (
                  <tr key={o.id} className={cx('cursor-pointer hover:bg-surface-2/60', o.status === 'placed' && 'bg-orange-50/60 dark:bg-orange-500/5')} onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td className="px-3 py-3">
                      <div className="font-bold">{o.code}</div>
                      <div className="text-xs text-muted">{timeAgo(o.placedAt)}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold">{o.contactName}</div>
                      <div className="text-xs text-muted">
                        {o.city ?? t('co.pickup')}
                        {o.hasNote ? t('ao.note_flag') : ''}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">{o.fulfillmentType === 'delivery' ? `🚚 ${t('co.delivery')}` : `🏪 ${t('co.pickup')}`}</td>
                    <td className="px-3 py-3">{o.itemCount}</td>
                    <td className="px-3 py-3 font-semibold">{money(o.totalCents)}</td>
                    <td className="px-3 py-3">
                      <Badge className={PAYMENT_TONE[o.paymentStatus]}>{t(`pay.${o.paymentStatus}` as TKey)}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={STATUS_META[o.status].tone}>{statusLabel(o.status)}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <QuickNext o={o} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {list.data!.orders.map((o) => (
              <Card key={o.id} className={cx(o.status === 'placed' && 'ring-2 ring-orange-300')}>
                <Link to={`/admin/orders/${o.id}`} className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">
                      {o.code} <span className="font-normal text-muted">· {timeAgo(o.placedAt)}</span>
                    </span>
                    <Badge className={STATUS_META[o.status].tone}>{statusLabel(o.status)}</Badge>
                  </div>
                  <div className="mt-1 text-sm">
                    {o.contactName} · {o.fulfillmentType === 'delivery' ? `🚚 ${o.city ?? ''}` : `🏪 ${t('co.pickup')}`} · {t('ao.items', { n: o.itemCount ?? 0 })}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-extrabold">{money(o.totalCents)}</span>
                    <Badge className={PAYMENT_TONE[o.paymentStatus]}>
                      {t('ao.cash')} · {t(`pay.${o.paymentStatus}` as TKey)}
                    </Badge>
                  </div>
                </Link>
                <div className="mt-3">
                  <QuickNext o={o} block />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const FLOW: Record<'delivery' | 'pickup', OrderStatus[]> = {
  delivery: ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'],
  pickup: ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'collected'],
};

function QuickNext({ o, block }: { o: OrderSummary; block?: boolean }) {
  const m = useStatusMutation(o.id);
  const flow = FLOW[o.fulfillmentType];
  const idx = flow.indexOf(o.status);
  const next = idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
  if (!next) return null;
  return (
    <Button size="sm" block={block} loading={m.isPending} onClick={() => m.mutate({ status: next })}>
      {nextLabel(next)}
    </Button>
  );
}

const PAYMENT_ACTION: Record<PaymentStatus, TKey> = { paid: 'ao.pay_paid', failed: 'ao.pay_failed', refunded: 'ao.pay_refunded', unpaid: 'ao.pay_unpaid' };

export function OrderDetailPage() {
  const id = Number(useParams().id);
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api<{ order: StaffOrderDetail }>(`/admin/orders/${id}`).then((r) => r.order), refetchInterval: 15_000 });
  const status = useStatusMutation(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState('');

  const payment = useMutation({
    mutationFn: (body: { status: PaymentStatus; note?: string }) => api<{ order: StaffOrderDetail; pointsReversed: number }>(`/admin/orders/${id}/payment`, { body }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'order', id], r.order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'pulse'] });
      toast(r.pointsReversed ? t('ao.refund_toast', { n: r.pointsReversed }) : t('ao.payment_toast', { status: t(`pay.${r.order.paymentStatus}` as TKey) }), 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const addNote = useMutation({
    mutationFn: () => api<{ order: StaffOrderDetail }>(`/admin/orders/${id}/notes`, { body: { note } }),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'order', id], r.order);
      setNote('');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const forward = o.allowedNext.filter((s) => s !== 'cancelled');
  const canCancel = o.allowedNext.includes('cancelled');
  const pickedCount = o.items.filter((i) => picked[i.id]).length;
  const type = o.fulfillmentType === 'delivery' ? `🚚 ${t('co.delivery')}` : `🏪 ${t('co.pickup')}`;

  return (
    <div>
      <Link to="/admin/orders" className="mb-3 inline-block text-sm font-semibold text-muted">
        {t('ao.all_orders')}
      </Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold">{t('ao.order_title', { code: o.code })}</h1>
            <Badge className={STATUS_META[o.status].tone}>{statusLabel(o.status)}</Badge>
            <Badge className={PAYMENT_TONE[o.paymentStatus]}>{t(`pay.${o.paymentStatus}` as TKey)}</Badge>
          </div>
          <p className="text-sm text-muted">{t('ao.placed_meta', { date: dateTime(o.placedAt), type, n: o.itemCount ?? 0 })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {forward.slice(0, 1).map((s) => (
            <Button key={s} size="lg" loading={status.isPending} onClick={() => status.mutate({ status: s })}>
              {nextLabel(s)}
            </Button>
          ))}
          {forward.slice(1).map((s) => (
            <Button key={s} variant="secondary" size="lg" onClick={() => status.mutate({ status: s })}>
              {t('ao.skip_to', { status: statusLabel(s) })}
            </Button>
          ))}
          {canCancel && (
            <Button variant="ghost" size="lg" className="text-rose-600" onClick={() => setCancelOpen(true)}>
              {t('ao.cancel')}
            </Button>
          )}
        </div>
      </div>

      {o.status === 'cancelled' && o.paymentStatus === 'paid' && (
        <Notice tone="error" className="mb-4">
          {t('ao.paid_cancelled')}
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Picking list */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">{t('ao.pick_title')}</h2>
              <span className="text-sm text-muted">{t('ao.picked', { a: pickedCount, b: o.items.length })}</span>
            </div>
            <div className="divide-y divide-line">
              {o.items.map((i) => (
                <label key={i.id} className={cx('flex cursor-pointer items-center gap-3 py-2.5', picked[i.id] && 'opacity-50')}>
                  <input type="checkbox" checked={!!picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
                  <div className="w-10">
                    <ProductImage emoji={i.emoji} imageUrl={i.imageUrl} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cx('font-semibold', picked[i.id] && 'line-through')}>
                      {i.name} {i.isGift && <Badge className="bg-amber-100 text-amber-900">{t('ao.reward_gift')}</Badge>}
                    </div>
                    <div className="text-xs text-muted">{i.unit}</div>
                  </div>
                  <div className="text-lg font-black">×{i.quantity}</div>
                  <div className="w-20 text-right text-sm">{i.isGift ? t('ao.free') : money(i.lineTotalCents)}</div>
                </label>
              ))}
            </div>
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">{t('ao.subtotal')}</span>
                <span>{money(o.subtotalCents)}</span>
              </div>
              {o.fulfillmentType === 'delivery' && (
                <div className="flex justify-between">
                  <span className="text-muted">{t('ao.delivery_fee')}</span>
                  <span>{o.deliveryFeeCents ? money(o.deliveryFeeCents) : t('ao.free')}</span>
                </div>
              )}
              {o.discountCents > 0 && (
                <div className="flex justify-between text-brand">
                  <span>{o.discountLabel}</span>
                  <span>−{money(o.discountCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-extrabold">
                <span>{o.paymentStatus === 'unpaid' ? t('ao.total_collect') : t('ao.total')}</span>
                <span>{money(o.totalCents)}</span>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <h2 className="mb-3 font-bold">{t('ao.activity')}</h2>
            <ol className="space-y-2.5 text-sm">
              {o.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-32 shrink-0 text-xs text-muted">{dateTime(e.createdAt)}</span>
                  <span>
                    {e.kind === 'status' && e.status && <b>{statusLabel(e.status)}</b>}
                    {e.kind === 'payment' && e.paymentStatus && <b>{t('ao.payment_event', { status: t(`pay.${e.paymentStatus}` as TKey) })}</b>}
                    {e.kind === 'note' && <b>{t('ao.note_event')}</b>}
                    {e.note && <span className="text-muted"> — {e.note}</span>}
                    {e.actorRole && <span className="text-xs text-muted"> · {t(`ad.role_${e.actorRole}` as TKey)}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ao.note_ph')} className="py-2" />
              <Button variant="secondary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>
                {t('ao.add')}
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Customer */}
          <Card>
            <h2 className="mb-3 font-bold">{t('ao.customer')}</h2>
            <div className="flex items-center gap-3">
              <Avatar name={o.customer.name} url={o.customer.photoUrl} />
              <div className="min-w-0">
                <Link to={`/admin/customers/${o.customer.id}`} className="font-semibold hover:underline">
                  {o.customer.name}
                </Link>
                <div className="text-xs text-muted">{t('ao.customer_stats', { orders: o.customer.orderCount, points: o.customer.pointsBalance })}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              <div>
                📞{' '}
                <a className="font-semibold text-brand" href={`tel:${o.contactPhone}`}>
                  {o.contactPhone}
                </a>{' '}
                <span className="text-muted">({o.contactName})</span>
              </div>
              {o.customer.username && (
                <div>
                  ✈️{' '}
                  <a className="font-semibold text-brand" href={`https://t.me/${o.customer.username}`} target="_blank" rel="noreferrer">
                    @{o.customer.username}
                  </a>
                </div>
              )}
            </div>
          </Card>

          {/* Fulfilment */}
          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">{o.fulfillmentType === 'delivery' ? t('ao.deliver_to') : t('ao.collects')}</h2>
            {o.address ? (
              <>
                <div className="font-semibold">{[o.address.line1, o.address.line2].filter(Boolean).join(', ')}</div>
                <div>
                  {o.address.city} {o.address.postalCode}
                </div>
                {o.address.instructions && <div className="mt-1 text-muted">{t('ao.directions', { text: o.address.instructions })}</div>}
                <a className="mt-2 inline-block font-semibold text-brand" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address.line1, o.address.city].join(', '))}`}>
                  {t('ao.open_maps')}
                </a>
              </>
            ) : (
              <div className="text-muted">{t('ao.at', { place: o.pickup?.address ?? '' })}</div>
            )}
            {o.customerNote && <div className="mt-3 rounded-xl bg-amber-50 p-3 font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">📝 “{o.customerNote}”</div>}
          </Card>

          {/* Payment */}
          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">{t('ao.payment')}</h2>
            <div className="flex items-center justify-between gap-2">
              <span>{t('pay.method_cash')}</span>
              <Badge className={PAYMENT_TONE[o.paymentStatus]}>{t(`pay.${o.paymentStatus}` as TKey)}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.allowedPayment.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === 'paid' ? 'primary' : p === 'refunded' ? 'danger' : 'secondary'}
                  loading={payment.isPending && payment.variables?.status === p}
                  onClick={() => {
                    if (p === 'refunded' && !window.confirm(t('ao.refund_confirm'))) return;
                    payment.mutate({ status: p });
                  }}
                >
                  {t(PAYMENT_ACTION[p])}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{t('ao.payment_separate')}</p>
          </Card>

          {o.pointsEstimate > 0 && (
            <Card className="text-sm">
              <h2 className="mb-1 text-base font-bold">{t('ao.loyalty')}</h2>
              {o.pointsReversed > 0 ? t('ao.pts_reversed', { n: o.pointsAwarded }) : o.pointsAwarded > 0 ? t('ao.pts_awarded', { n: o.pointsAwarded }) : t('ao.pts_pending', { n: o.pointsEstimate })}
            </Card>
          )}

          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">{t('ao.messages')}</h2>
            {o.notifications.length === 0 ? (
              <p className="text-muted">{t('ao.none_yet')}</p>
            ) : (
              <ul className="space-y-1.5">
                {o.notifications.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{kindLabel(n.kind)}</span>
                    <Badge className={n.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : n.status === 'simulated' ? 'bg-amber-100 text-amber-900' : n.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}>
                      {t(`ao.n_${n.status}` as TKey)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('ao.cancel_title', { code: o.code })}>
        <p className="mb-3 text-sm text-muted">{t('ao.cancel_text')}</p>
        <Field label={t('ao.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('ao.reason_ph')} />
        </Field>
        <div className="mt-4 grid gap-2">
          <Button variant="danger" block loading={status.isPending} onClick={() => status.mutate({ status: 'cancelled', reason: reason.trim() || undefined }, { onSuccess: () => setCancelOpen(false) })}>
            {t('ao.cancel')}
          </Button>
          <Button variant="ghost" block onClick={() => setCancelOpen(false)}>
            {t('ao.keep')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
