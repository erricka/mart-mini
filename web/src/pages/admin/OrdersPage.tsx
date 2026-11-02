import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { Avatar, Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, PageLoader, Sheet, Skeleton, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, money, timeAgo } from '../../lib/format';
import { PAYMENT_META, PAYMENT_METHOD_LABEL, STATUS_META } from '../../lib/status';
import { toast } from '../../lib/toast';
import type { OrderStatus, OrderSummary, PaymentStatus, StaffOrderDetail } from '../../lib/types';
import { PageHeader } from './common';

const NEXT_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: '✅ Accept order',
  preparing: '🧺 Start preparing',
  out_for_delivery: '🚚 Out for delivery',
  delivered: '📦 Mark delivered',
  ready_for_pickup: '🛍️ Ready for pickup',
  collected: '🎉 Mark collected',
};

const PAYMENT_ACTION: Record<PaymentStatus, string> = { paid: '💵 Mark paid', failed: 'Mark failed', refunded: '↩️ Refund', unpaid: 'Reset to unpaid' };

type View = 'active' | 'placed' | 'awaiting_payment' | 'completed' | 'cancelled' | 'all';
type AdminOrder = OrderSummary & { username: string | null; city: string | null; discountLabel: string | null; hasNote: boolean };

function useStatusMutation(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { status: OrderStatus; reason?: string; note?: string }) => api<{ order: StaffOrderDetail; points: number; changed: boolean }>(`/admin/orders/${id}/status`, { body }),
    onSuccess: (r, v) => {
      qc.setQueryData(['admin', 'order', id], r.order);
      qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      qc.invalidateQueries({ queryKey: ['admin', 'pulse'] });
      toast(r.points ? `${STATUS_META[v.status].label} · customer earned ${r.points} points ⭐` : `Order ${r.order.code}: ${STATUS_META[v.status].label}`, 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
}

export function OrdersPage({ counts }: { counts?: { newCount: number; activeCount: number; awaitingPaymentCount: number } }) {
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
    { id: 'active', label: 'Active', n: counts?.activeCount },
    { id: 'placed', label: '🆕 New', n: counts?.newCount },
    { id: 'awaiting_payment', label: 'Awaiting payment', n: counts?.awaitingPaymentCount },
    { id: 'completed', label: 'Completed' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div>
      <PageHeader title="Orders" subtitle="New orders appear automatically. QR orders show up once the customer has paid." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setView(t.id)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold transition', view === t.id ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
            {t.label}
            {t.n ? <span className={cx('ml-1.5 rounded-full px-1.5 text-xs', t.id === 'placed' ? 'bg-orange-500 text-white' : 'bg-surface-2 text-ink')}>{t.n}</span> : null}
          </button>
        ))}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search # / name / phone" className="ml-auto max-w-60 py-2" />
      </div>
      {view === 'awaiting_payment' && (
        <Notice tone="info" className="mb-3">These customers haven't finished paying by QR. Don't prepare them yet — they move to “New” automatically once paid, or are cancelled when the payment window ends.</Notice>
      )}

      {list.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.orders.length === 0 ? (
        <EmptyState emoji={view === 'active' || view === 'placed' ? '☕' : '🗂️'} title={view === 'active' || view === 'placed' ? 'All caught up!' : 'No orders here'} text={view === 'active' ? 'New orders will pop up here with a sound and a toast.' : undefined} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-line">
                <tr>
                  {['Order', 'Customer', 'Type', 'Items', 'Total', 'Payment', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data!.orders.map((o) => (
                  <tr key={o.id} className={cx('cursor-pointer hover:bg-surface-2/60', o.status === 'placed' && 'bg-orange-50/60 dark:bg-orange-500/5')} onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td className="px-3 py-3"><div className="font-bold">{o.code}</div><div className="text-xs text-muted">{timeAgo(o.placedAt)}</div></td>
                    <td className="px-3 py-3"><div className="font-semibold">{o.contactName}</div><div className="text-xs text-muted">{o.city ?? 'Pickup'}{o.hasNote ? ' · 📝 note' : ''}</div></td>
                    <td className="px-3 py-3">{o.fulfillmentType === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'}</td>
                    <td className="px-3 py-3">{o.itemCount}</td>
                    <td className="px-3 py-3 font-semibold">{money(o.totalCents)}</td>
                    <td className="px-3 py-3"><Badge className={PAYMENT_META[o.paymentStatus].tone}>{o.paymentMethod === 'qr' ? 'QR · ' : 'Cash · '}{PAYMENT_META[o.paymentStatus].label}</Badge></td>
                    <td className="px-3 py-3"><Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge></td>
                    <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}><QuickNext o={o} /></td>
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
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{o.code} <span className="font-normal text-muted">· {timeAgo(o.placedAt)}</span></span>
                    <Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge>
                  </div>
                  <div className="mt-1 text-sm">{o.contactName} · {o.fulfillmentType === 'delivery' ? `🚚 ${o.city ?? ''}` : '🏪 Pickup'} · {o.itemCount} items</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-extrabold">{money(o.totalCents)}</span>
                    <Badge className={PAYMENT_META[o.paymentStatus].tone}>{o.paymentMethod === 'qr' ? 'QR' : 'Cash'} · {PAYMENT_META[o.paymentStatus].label}</Badge>
                  </div>
                </Link>
                <div className="mt-3"><QuickNext o={o} block /></div>
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
      {NEXT_LABEL[next]}
    </Button>
  );
}

export function OrderDetailPage() {
  const id = Number(useParams().id);
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
      toast(r.pointsReversed ? `Refunded · ${r.pointsReversed} points reversed` : `Payment: ${PAYMENT_META[r.order.paymentStatus].label}`, 'success');
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

  return (
    <div>
      <Link to="/admin/orders" className="mb-3 inline-block text-sm font-semibold text-muted">← All orders</Link>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold">Order {o.code}</h1>
            <Badge className={STATUS_META[o.status].tone}>{STATUS_META[o.status].label}</Badge>
            <Badge className={PAYMENT_META[o.paymentStatus].tone}>{PAYMENT_META[o.paymentStatus].label}</Badge>
          </div>
          <p className="text-sm text-muted">Placed {dateTime(o.placedAt)} · {o.fulfillmentType === 'delivery' ? '🚚 Delivery' : '🏪 Pickup'} · {o.itemCount} items</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {forward.slice(0, 1).map((s) => (
            <Button key={s} size="lg" loading={status.isPending} onClick={() => status.mutate({ status: s })}>{NEXT_LABEL[s]}</Button>
          ))}
          {forward.slice(1).map((s) => (
            <Button key={s} variant="secondary" size="lg" onClick={() => status.mutate({ status: s })}>Skip to {STATUS_META[s].label.toLowerCase()}</Button>
          ))}
          {canCancel && <Button variant="ghost" size="lg" className="text-rose-600" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
        </div>
      </div>

      {o.status === 'awaiting_payment' && (
        <Notice tone="warn" className="mb-4">
          ⏳ The customer hasn't completed the QR payment yet{o.payment?.expiresAt ? ` (window ends ${dateTime(o.payment.expiresAt)})` : ''}. Don't prepare it yet. If you can see the money in your ABA account, mark it paid below and it moves to “New”.
        </Notice>
      )}
      {o.status === 'cancelled' && o.paymentStatus === 'paid' && <Notice tone="error" className="mb-4">This order was cancelled but is marked paid — refund the customer and mark it refunded.</Notice>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Picking list */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Items to pick</h2>
              <span className="text-sm text-muted">{pickedCount}/{o.items.length} picked</span>
            </div>
            <div className="divide-y divide-line">
              {o.items.map((i) => (
                <label key={i.id} className={cx('flex cursor-pointer items-center gap-3 py-2.5', picked[i.id] && 'opacity-50')}>
                  <input type="checkbox" checked={!!picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
                  <div className="w-10"><ProductImage emoji={i.emoji} imageUrl={i.imageUrl} size="sm" /></div>
                  <div className="min-w-0 flex-1">
                    <div className={cx('font-semibold', picked[i.id] && 'line-through')}>{i.name} {i.isGift && <Badge className="bg-amber-100 text-amber-900">🎁 reward gift</Badge>}</div>
                    <div className="text-xs text-muted">{i.unit}</div>
                  </div>
                  <div className="text-lg font-black">×{i.quantity}</div>
                  <div className="w-20 text-right text-sm">{i.isGift ? 'FREE' : money(i.lineTotalCents)}</div>
                </label>
              ))}
            </div>
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(o.subtotalCents)}</span></div>
              {o.fulfillmentType === 'delivery' && <div className="flex justify-between"><span className="text-muted">Delivery fee</span><span>{o.deliveryFeeCents ? money(o.deliveryFeeCents) : 'Free'}</span></div>}
              {o.discountCents > 0 && <div className="flex justify-between text-brand"><span>{o.discountLabel}</span><span>−{money(o.discountCents)}</span></div>}
              <div className="flex justify-between text-base font-extrabold"><span>Total {o.paymentMethod === 'cash' && o.paymentStatus === 'unpaid' ? 'to collect' : ''}</span><span>{money(o.totalCents)}</span></div>
            </div>
          </Card>

          {/* Timeline */}
          <Card>
            <h2 className="mb-3 font-bold">Activity</h2>
            <ol className="space-y-2.5 text-sm">
              {o.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-28 shrink-0 text-xs text-muted">{dateTime(e.createdAt)}</span>
                  <span>
                    {e.kind === 'status' && e.status && <b>{STATUS_META[e.status].label}</b>}
                    {e.kind === 'payment' && e.paymentStatus && <b>Payment: {PAYMENT_META[e.paymentStatus].label}</b>}
                    {e.kind === 'note' && <b>📝 Note</b>}
                    {e.note && <span className="text-muted"> — {e.note}</span>}
                    {e.actorRole && <span className="text-xs text-muted"> · {e.actorRole}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note (not sent to the customer)" className="py-2" />
              <Button variant="secondary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Add</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Customer */}
          <Card>
            <h2 className="mb-3 font-bold">Customer</h2>
            <div className="flex items-center gap-3">
              <Avatar name={o.customer.name} url={o.customer.photoUrl} />
              <div className="min-w-0">
                <Link to={`/admin/customers/${o.customer.id}`} className="font-semibold hover:underline">{o.customer.name}</Link>
                <div className="text-xs text-muted">{o.customer.orderCount} orders · {o.customer.pointsBalance} pts</div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              <div>📞 <a className="font-semibold text-brand" href={`tel:${o.contactPhone}`}>{o.contactPhone}</a> <span className="text-muted">({o.contactName})</span></div>
              {o.customer.username && <div>✈️ <a className="font-semibold text-brand" href={`https://t.me/${o.customer.username}`} target="_blank" rel="noreferrer">@{o.customer.username}</a></div>}
            </div>
          </Card>

          {/* Fulfilment */}
          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">{o.fulfillmentType === 'delivery' ? '🚚 Deliver to' : '🏪 Customer collects'}</h2>
            {o.address ? (
              <>
                <div className="font-semibold">{[o.address.line1, o.address.line2].filter(Boolean).join(', ')}</div>
                <div>{o.address.city} {o.address.postalCode}</div>
                {o.address.instructions && <div className="mt-1 text-muted">Directions: {o.address.instructions}</div>}
                <a className="mt-2 inline-block font-semibold text-brand" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([o.address.line1, o.address.city].join(', '))}`}>Open in Maps ↗</a>
              </>
            ) : (
              <div className="text-muted">At {o.pickup?.address}</div>
            )}
            {o.customerNote && <div className="mt-3 rounded-xl bg-amber-50 p-3 font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">📝 “{o.customerNote}”</div>}
          </Card>

          {/* Payment */}
          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">Payment</h2>
            <div className="flex items-center justify-between">
              <span>{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
              <Badge className={PAYMENT_META[o.paymentStatus].tone}>{PAYMENT_META[o.paymentStatus].label}</Badge>
            </div>
            {o.payment?.reference && <div className="mt-1 text-xs text-muted">Ref {o.payment.reference}{o.payment.provider === 'simulated' ? ' · SIMULATED' : ''}{o.payment.paidAt ? ` · paid ${dateTime(o.payment.paidAt)}` : ''}</div>}
            <div className="mt-3 flex flex-wrap gap-2">
              {o.allowedPayment.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === 'paid' ? 'primary' : p === 'refunded' ? 'danger' : 'secondary'}
                  loading={payment.isPending && payment.variables?.status === p}
                  onClick={() => {
                    if (p === 'refunded' && !window.confirm('Mark this order as refunded? Points earned on it will be reversed.')) return;
                    payment.mutate({ status: p });
                  }}
                >
                  {PAYMENT_ACTION[p]}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Payment status is tracked separately from the order's progress.</p>
          </Card>

          {o.pointsEstimate > 0 && (
            <Card className="text-sm">
              <h2 className="mb-1 text-base font-bold">⭐ Loyalty</h2>
              {o.pointsReversed > 0 ? `${o.pointsAwarded} points awarded, then reversed by refund.` : o.pointsAwarded > 0 ? `${o.pointsAwarded} points awarded.` : `${o.pointsEstimate} points will be awarded when the order is completed.`}
            </Card>
          )}

          <Card className="text-sm">
            <h2 className="mb-2 text-base font-bold">Telegram messages</h2>
            {o.notifications.length === 0 ? <p className="text-muted">None yet.</p> : (
              <ul className="space-y-1.5">
                {o.notifications.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{n.kind.replace(/_/g, ' ')}</span>
                    <Badge className={n.status === 'sent' ? 'bg-emerald-100 text-emerald-800' : n.status === 'simulated' ? 'bg-amber-100 text-amber-900' : n.status === 'failed' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}>{n.status === 'simulated' ? 'SIMULATED' : n.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Cancel order ${o.code}?`}>
        <p className="mb-3 text-sm text-muted">Stock is put back automatically and any reward or coupon returns to the customer. They'll get a Telegram message with your reason.</p>
        <Field label="Reason (shown to the customer)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sorry, salmon is out of stock today" />
        </Field>
        <div className="mt-4 grid gap-2">
          <Button variant="danger" block loading={status.isPending} onClick={() => status.mutate({ status: 'cancelled', reason: reason.trim() || undefined }, { onSuccess: () => setCancelOpen(false) })}>Cancel order</Button>
          <Button variant="ghost" block onClick={() => setCancelOpen(false)}>Keep it</Button>
        </div>
      </Sheet>
    </div>
  );
}
