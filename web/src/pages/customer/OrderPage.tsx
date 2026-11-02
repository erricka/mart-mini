import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { Timeline } from '../../components/Timeline';
import { Badge, Button, Card, celebrate, ErrorState, Field, Notice, PageLoader, Sheet, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, money } from '../../lib/format';
import { useOrder } from '../../lib/queries';
import { PAYMENT_META, PAYMENT_METHOD_LABEL, STATUS_META } from '../../lib/status';
import { toast } from '../../lib/toast';
import { needsWriteAccess, requestBotMessages } from '../../lib/telegram';

export function OrderPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const q = useOrder(id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const justPlaced = params.get('placed') === '1';
  const fired = useRef(false);
  const [askUpdates, setAskUpdates] = useState(needsWriteAccess());

  useEffect(() => {
    if (justPlaced && q.data && !fired.current) {
      fired.current = true;
      setTimeout(celebrate, 200);
    }
  }, [justPlaced, q.data]);

  const cancel = useMutation({
    mutationFn: () => api(`/orders/${id}/cancel`, { body: { reason: reason.trim() || null } }),
    onSuccess: () => {
      setCancelOpen(false);
      toast('Your order was cancelled.', 'info');
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const meta = STATUS_META[o.status];
  const completed = o.status === 'delivered' || o.status === 'collected';

  return (
    <div className="space-y-4">
      {justPlaced && o.status !== 'cancelled' && (
        <div className="animate-rise rounded-3xl bg-gradient-to-br from-green-400 to-emerald-600 p-5 text-white shadow-lg">
          <div className="text-3xl">🎉</div>
          <h1 className="mt-1 text-xl font-extrabold">Order placed!</h1>
          <p className="text-sm text-white/90">The shop has your order. We'll message you in Telegram as it moves along.</p>
          <button className="mt-2 text-sm font-semibold underline" onClick={() => setParams({}, { replace: true })}>Dismiss</button>
        </div>
      )}
      {askUpdates && o.status !== 'cancelled' && (
        <button
          onClick={async () => {
            await requestBotMessages();
            setAskUpdates(false);
          }}
          className="flex w-full items-center gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-left text-sm font-semibold text-sky-900 dark:bg-sky-500/10 dark:text-sky-200"
        >
          🔔 Allow Telegram messages so we can tell you when your order moves along →
        </button>
      )}

      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">{dateTime(o.placedAt)}</p>
          <h1 className="text-2xl font-extrabold">Order {o.code}</h1>
        </div>
        <Badge className={meta.tone}>{meta.label}</Badge>
      </div>

      {o.status === 'awaiting_payment' && (
        <Link to={`/orders/${o.id}/pay`}>
          <Notice tone="warn" className="font-semibold">📱 Waiting for your QR payment — tap to pay and send the order to the shop →</Notice>
        </Link>
      )}

      <Card className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-4xl">{meta.emoji}</div>
        <div>
          <div className="text-lg font-bold">{meta.label}</div>
          <div className="text-sm text-muted">{o.status === 'cancelled' && o.cancelReason ? o.cancelReason : meta.blurb}</div>
        </div>
      </Card>

      {o.pointsEstimate > 0 && o.status !== 'cancelled' && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {o.pointsReversed > 0
            ? `↩️ ${o.pointsReversed} points were removed after a refund.`
            : completed && o.pointsAwarded > 0
              ? `⭐ You earned ${o.pointsAwarded} points with this order!`
              : `⭐ ${o.pointsEstimate} points will be added when your order is ${o.fulfillmentType === 'delivery' ? 'delivered' : 'collected'}.`}
        </div>
      )}

      <Card>
        <h2 className="mb-3 font-bold">Tracking</h2>
        <Timeline steps={o.timeline} />
        <p className="mt-3 text-xs text-muted">Status updates come from the shop team. Live driver tracking is coming later.</p>
      </Card>

      <Card className="space-y-1 text-sm">
        <h2 className="mb-1 text-base font-bold">{o.fulfillmentType === 'delivery' ? '🚚 Delivery to' : '🏪 Pickup at'}</h2>
        {o.address ? (
          <>
            <div className="font-semibold">{[o.address.line1, o.address.line2].filter(Boolean).join(', ')}</div>
            <div className="text-muted">{o.address.city}</div>
            {o.address.instructions && <div className="text-muted">“{o.address.instructions}”</div>}
          </>
        ) : (
          <>
            <div className="font-semibold">{o.pickup?.address}</div>
            <div className="text-muted">{o.pickup?.hours}</div>
          </>
        )}
        <div className="pt-1 text-muted">Contact: {o.contactName} · {o.contactPhone}</div>
        {o.customerNote && <div className="text-muted">Note: {o.customerNote}</div>}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold">Items</h2>
        <div className="space-y-2.5">
          {o.items.map((i) => (
            <div key={i.id} className="flex items-center gap-3">
              <div className="w-11 shrink-0"><ProductImage emoji={i.emoji} imageUrl={i.imageUrl} size="sm" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{i.name}{i.isGift && ' 🎁'}</div>
                <div className="text-xs text-muted">{i.quantity} × {i.isGift ? 'Gift' : money(i.unitPriceCents)}</div>
              </div>
              <div className="text-sm font-semibold">{i.isGift ? 'FREE' : money(i.lineTotalCents)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(o.subtotalCents)}</span></div>
          {o.fulfillmentType === 'delivery' && <div className="flex justify-between"><span className="text-muted">Delivery</span><span>{o.deliveryFeeCents ? money(o.deliveryFeeCents) : 'FREE'}</span></div>}
          {o.discountCents > 0 && <div className="flex justify-between text-brand"><span>{o.discountLabel ?? 'Discount'}</span><span>−{money(o.discountCents)}</span></div>}
          <div className="flex justify-between pt-1 text-base font-extrabold"><span>Total</span><span>{money(o.totalCents)}</span></div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-muted">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
            <Badge className={PAYMENT_META[o.paymentStatus].tone}>{PAYMENT_META[o.paymentStatus].label}</Badge>
          </div>
        </div>
      </Card>

      {o.canCancel && (
        <Button variant="ghost" block className="text-rose-600" onClick={() => setCancelOpen(true)}>
          Cancel order
        </Button>
      )}
      {!o.canCancel && o.status !== 'cancelled' && !completed && o.supportPhone && (
        <p className="text-center text-sm text-muted">Need to change something? Call the shop: <a className="font-semibold text-brand" href={`tel:${o.supportPhone}`}>{o.supportPhone}</a></p>
      )}

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order?">
        <p className="mb-3 text-sm text-muted">The items go back on the shelf and any reward you used returns to your wallet.</p>
        <Field label="Reason (optional)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. ordered by mistake" maxLength={300} />
        </Field>
        <div className="mt-4 grid gap-2">
          <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel order</Button>
          <Button variant="ghost" block onClick={() => setCancelOpen(false)}>Keep my order</Button>
        </div>
      </Sheet>
    </div>
  );
}
