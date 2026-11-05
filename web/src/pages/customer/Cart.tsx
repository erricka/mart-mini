import { useQuery } from '@tanstack/react-query';
import { ShoppingBasket, Star } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { QtyStepper } from '../../components/QtyStepper';
import { Button, Card, EmptyState, Notice, ProgressBar, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { cartSubtotal, useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useShop } from '../../lib/queries';
import type { DeliverySpeed, LatLng, Quote } from '../../lib/types';

export function useCartQuote(
  fulfillmentType: 'delivery' | 'pickup',
  discount: { couponCode?: string | null; customerRewardId?: number | null } = {},
  delivery: { location?: LatLng | null; deliverySpeed?: DeliverySpeed; addressReady?: boolean } = {},
) {
  const lines = useCart((s) => s.lines);
  const items = lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  const location = fulfillmentType === 'delivery' ? (delivery.location ?? null) : null;
  const deliverySpeed = delivery.deliverySpeed ?? 'same_day';
  const addressReady = fulfillmentType === 'delivery' && !!delivery.addressReady;
  return useQuery({
    queryKey: ['quote', items, fulfillmentType, discount.couponCode ?? null, discount.customerRewardId ?? null, location?.lat, location?.lng, deliverySpeed, addressReady],
    enabled: items.length > 0,
    // The previous quote stays visible while recalculating, but screens must treat it as stale
    // (isPlaceholderData / isFetching) — never place an order with it.
    placeholderData: (prev) => prev,
    // Prices, stock and fees are always re-checked with the server (no reuse of a recent quote).
    staleTime: 0,
    queryFn: () =>
      api<{ quote: Quote; discounts: { wallet: any[]; publicCoupons: any[] } }>('/checkout/quote', {
        body: { items, fulfillmentType, ...discount, location, deliverySpeed, addressReady },
      }),
  });
}

export function Cart() {
  const navigate = useNavigate();
  const { t } = useT();
  const lines = useCart((s) => s.lines);
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  const clear = useCart((s) => s.clear);
  const syncStock = useCart((s) => s.syncStock);
  const shop = useShop();
  const quote = useCartQuote(shop.data?.deliveryEnabled === false ? 'pickup' : 'delivery');
  const q = quote.data?.quote;

  useEffect(() => {
    if (q) syncStock(q.lines.filter((l) => !l.isGift).map((l) => ({ productId: l.productId, available: l.available })));
  }, [q, syncStock]);

  if (lines.length === 0) {
    return (
      <EmptyState
        emoji={<ShoppingBasket className="h-9 w-9" strokeWidth={1.5} />}
        title={t('cart.empty_title')}
        text={t('cart.empty_text')}
        action={<Link to="/shop"><Button size="lg">{t('cart.start')}</Button></Link>}
      />
    );
  }

  const issues = q?.lines.filter((l) => l.issue && !l.isGift) ?? [];
  const fixAll = () => {
    for (const l of issues) {
      if (l.available <= 0 || l.issue === 'unavailable') remove(l.productId);
      else setQty(l.productId, l.available);
    }
    for (const id of q?.missingProductIds ?? []) remove(id);
  };
  const subtotal = q?.subtotalCents ?? cartSubtotal(lines);
  const freeMin = shop.data?.freeDeliveryMinCents;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-bold">{t('cart.title')}</h1>
        <button className="text-sm font-semibold text-muted" onClick={clear}>{t('cart.clear')}</button>
      </div>

      {(issues.length > 0 || (q?.missingProductIds.length ?? 0) > 0) && (
        <Notice tone="warn" className="mb-3">
          <div className="font-semibold">{t('cart.changed')}</div>
          <button onClick={fixAll} className="mt-1 font-bold underline">{t('cart.update')}</button>
        </Notice>
      )}

      <div className="divide-y divide-line rounded-2xl bg-surface px-3">
        {lines.map((l) => {
          const ql = q?.lines.find((x) => x.productId === l.productId && !x.isGift);
          const gone = q?.missingProductIds.includes(l.productId);
          return (
            <div key={l.productId} className="flex items-center gap-3 py-3">
              <Link to={`/product/${l.productId}`} className="w-14 shrink-0">
                <ProductImage emoji={l.emoji} imageUrl={l.imageUrl} size="sm" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px]">{l.name}</div>
                <div className="text-xs text-muted">{l.unit} · {money(ql?.unitPriceCents ?? l.priceCents)}</div>
                {gone ? (
                  <div className="text-xs font-semibold text-rose-600">{t('cart.no_longer')}</div>
                ) : ql?.issue === 'insufficient_stock' ? (
                  <div className="text-xs font-semibold text-orange-600">{t('product.only_left', { n: ql.available })}</div>
                ) : ql?.issue ? (
                  <div className="text-xs font-semibold text-rose-600">{t('product.out_of_stock')}</div>
                ) : (
                  <div className="text-sm font-bold">{money((ql?.unitPriceCents ?? l.priceCents) * l.quantity)}</div>
                )}
              </div>
              <QtyStepper size="sm" value={l.quantity} max={Math.max(1, Math.min(l.stock, 99))} onChange={(v) => setQty(l.productId, v)} />
            </div>
          );
        })}
      </div>

      {/* Progress against the shop's actual free-delivery rule. Free delivery itself is only applied at
          checkout, once the address is validated — so no "free delivery" fee label here. */}
      {freeMin != null && shop.data?.deliveryEnabled && (
        <Card className="mt-3">
          {subtotal >= freeMin ? (
            <p className="text-sm font-semibold">{t('cart.free_reached', { min: money(freeMin) })}</p>
          ) : (
            <>
              <p className="text-sm font-semibold">{t('cart.add_more_rule', { amount: money(freeMin - subtotal), min: money(freeMin) })}</p>
              <ProgressBar percent={(subtotal / freeMin) * 100} tone="brand" className="mt-2" />
            </>
          )}
        </Card>
      )}

      <Card className="mt-3 space-y-2">
        <div className="flex justify-between"><span className="text-muted">{t('co.subtotal')}</span><span className="font-semibold">{money(subtotal)}</span></div>
        {shop.data?.deliveryEnabled && (
          <div className="flex justify-between gap-3 text-sm"><span className="text-muted">{t('co.delivery_fee')}</span><span className="text-right text-muted">{t('cart.fee_at_checkout')}</span></div>
        )}
        {quote.isFetching && !q ? <Skeleton className="h-4 w-32" /> : q && q.pointsEstimate > 0 && (
          <div className="flex items-center gap-1 pt-1 text-sm text-muted">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {t('cart.earn_about', { n: q.pointsEstimate })}
          </div>
        )}
      </Card>

      {q && q.minOrderRemainingCents > 0 && <Notice tone="info" className="mt-3">{t('cart.min_order', { amount: money(q.minOrderRemainingCents), min: money(shop.data?.minOrderCents ?? 0) })}</Notice>}

      <div className="pb-safe fixed inset-x-0 bottom-[68px] z-30 mx-auto max-w-xl px-4 pb-3">
        <Button
          block
          size="lg"
          disabled={!q || issues.length > 0 || (q?.missingProductIds.length ?? 0) > 0 || (q?.minOrderRemainingCents ?? 0) > 0}
          onClick={() => navigate('/checkout')}
          className="shadow-lg shadow-black/10"
        >
          {t('cart.continue')}
        </Button>
      </div>
    </div>
  );
}
