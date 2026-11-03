import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { Timeline } from '../../components/Timeline';
import { Badge, Button, Card, celebrate, ErrorState, Field, PageLoader, Sheet, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, dayLabel, money } from '../../lib/format';
import { useOrder } from '../../lib/queries';
import { useT } from '../../lib/i18n';
import { PAYMENT_TONE, STATUS_META } from '../../lib/status';
import { toast } from '../../lib/toast';
import { needsWriteAccess, requestBotMessages } from '../../lib/telegram';

export function OrderPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { t } = useT();
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
      toast(t('order.cancelled_toast'), 'info');
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
          <h1 className="mt-1 text-xl font-extrabold">{t('order.placed_title')}</h1>
          <p className="text-sm text-white/90">{t('order.placed_text')}</p>
          <button className="mt-2 text-sm font-semibold underline" onClick={() => setParams({}, { replace: true })}>{t('order.dismiss')}</button>
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
          {t('order.allow_updates')}
        </button>
      )}

      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted">{dateTime(o.placedAt)}</p>
          <h1 className="text-2xl font-extrabold">{t('order.title', { code: o.code })}</h1>
        </div>
        <Badge className={meta.tone}>{t(`status.${o.status}`)}</Badge>
      </div>


      <Card className="flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 text-4xl">{meta.emoji}</div>
        <div>
          <div className="text-lg font-bold">{t(`status.${o.status}`)}</div>
          <div className="text-sm text-muted">{o.status === 'cancelled' && o.cancelReason ? o.cancelReason : t(`blurb.${o.status}`)}</div>
        </div>
      </Card>

      {o.pointsEstimate > 0 && o.status !== 'cancelled' && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {o.pointsReversed > 0
            ? t('order.pts_reversed', { n: o.pointsReversed })
            : completed && o.pointsAwarded > 0
              ? t('order.pts_earned', { n: o.pointsAwarded })
              : t(o.fulfillmentType === 'delivery' ? 'order.pts_pending_delivered' : 'order.pts_pending_collected', { n: o.pointsEstimate })}
        </div>
      )}

      <Card>
        <h2 className="mb-3 font-bold">{t('order.tracking')}</h2>
        <Timeline steps={o.timeline} />
        <p className="mt-3 text-xs text-muted">{t('order.tracking_note')}</p>
      </Card>

      <Card className="space-y-1 text-sm">
        <h2 className="mb-1 text-base font-bold">{o.fulfillmentType === 'delivery' ? t('order.delivery_to') : t('order.pickup_at')}</h2>
        {o.address ? (
          <>
            <div className="font-semibold">{[o.address.line1, o.address.line2].filter(Boolean).join(', ')}</div>
            <div className="text-muted">{o.address.city}</div>
            {o.address.instructions && <div className="text-muted">“{o.address.instructions}”</div>}
            {o.delivery?.speed && (
              <div className="pt-1 font-semibold">
                {o.delivery.speed === 'next_day' ? t('order.deliver_tomorrow', { date: dayLabel(o.delivery.date) }) : t('order.deliver_today')}
              </div>
            )}
            {o.delivery?.distanceKm != null && <div className="text-muted">{t('order.km', { km: o.delivery.distanceKm })}</div>}
          </>
        ) : (
          <>
            <div className="font-semibold">{o.pickup?.address}</div>
            <div className="text-muted">{o.pickup?.hours}</div>
          </>
        )}
        <div className="pt-1 text-muted">{t('order.contact', { name: o.contactName, phone: o.contactPhone })}</div>
        {o.customerNote && <div className="text-muted">{t('order.note', { note: o.customerNote })}</div>}
      </Card>

      <Card>
        <h2 className="mb-3 font-bold">{t('order.items')}</h2>
        <div className="space-y-2.5">
          {o.items.map((i) => (
            <div key={i.id} className="flex items-center gap-3">
              <div className="w-11 shrink-0"><ProductImage emoji={i.emoji} imageUrl={i.imageUrl} size="sm" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{i.name}{i.isGift && ' 🎁'}</div>
                <div className="text-xs text-muted">{i.quantity} × {i.isGift ? t('order.gift') : money(i.unitPriceCents)}</div>
              </div>
              <div className="text-sm font-semibold">{i.isGift ? t('common.free_caps') : money(i.lineTotalCents)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">{t('cart.subtotal')}</span><span>{money(o.subtotalCents)}</span></div>
          {o.fulfillmentType === 'delivery' && <div className="flex justify-between"><span className="text-muted">{t('order.delivery')}</span><span>{o.deliveryFeeCents ? money(o.deliveryFeeCents) : t('common.free_caps')}</span></div>}
          {o.discountCents > 0 && <div className="flex justify-between text-brand"><span>{o.discountLabel ?? t('co.discount')}</span><span>−{money(o.discountCents)}</span></div>}
          <div className="flex justify-between pt-1 text-base font-extrabold"><span>{t('co.total')}</span><span>{money(o.totalCents)}</span></div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-muted">{t('pay.method_cash')}</span>
            <Badge className={PAYMENT_TONE[o.paymentStatus]}>{t(`pay.${o.paymentStatus}`)}</Badge>
          </div>
        </div>
      </Card>

      {o.canCancel && (
        <Button variant="ghost" block className="text-rose-600" onClick={() => setCancelOpen(true)}>
          {t('order.cancel')}
        </Button>
      )}
      {!o.canCancel && o.status !== 'cancelled' && !completed && o.supportPhone && (
        <p className="text-center text-sm text-muted">{t('order.call_shop')} <a className="font-semibold text-brand" href={`tel:${o.supportPhone}`}>{o.supportPhone}</a></p>
      )}

      <Sheet open={cancelOpen} onClose={() => setCancelOpen(false)} title={t('order.cancel_title')}>
        <p className="mb-3 text-sm text-muted">{t('order.cancel_text')}</p>
        <Field label={t('order.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('order.reason_ph')} maxLength={300} />
        </Field>
        <div className="mt-4 grid gap-2">
          <Button variant="danger" block loading={cancel.isPending} onClick={() => cancel.mutate()}>{t('order.yes_cancel')}</Button>
          <Button variant="ghost" block onClick={() => setCancelOpen(false)}>{t('order.keep')}</Button>
        </div>
      </Sheet>
    </div>
  );
}
