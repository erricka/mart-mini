import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ProductImage } from '../../components/ProductImage';
import { QtyStepper } from '../../components/QtyStepper';
import { Button, Card, EmptyState, Notice, ProgressBar, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { cartSubtotal, useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useShop } from '../../lib/queries';
import type { Quote } from '../../lib/types';

export function useCartQuote(fulfillmentType: 'delivery' | 'pickup', discount: { couponCode?: string | null; customerRewardId?: number | null } = {}) {
  const lines = useCart((s) => s.lines);
  const items = lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
  return useQuery({
    queryKey: ['quote', items, fulfillmentType, discount.couponCode ?? null, discount.customerRewardId ?? null],
    enabled: items.length > 0,
    placeholderData: (prev) => prev,
    queryFn: () => api<{ quote: Quote; discounts: { wallet: any[]; publicCoupons: any[] } }>('/checkout/quote', { body: { items, fulfillmentType, ...discount } }),
  });
}

export function Cart() {
  const navigate = useNavigate();
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
        emoji="🧺"
        title="Your basket is empty"
        text="Fresh fruit, snacks, household basics — add a few things and they'll show up here."
        action={<Link to="/shop"><Button size="lg">Start shopping</Button></Link>}
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
        <h1 className="text-2xl font-extrabold tracking-tight">Your basket</h1>
        <button className="text-sm font-semibold text-muted" onClick={clear}>Clear</button>
      </div>

      {(issues.length > 0 || (q?.missingProductIds.length ?? 0) > 0) && (
        <Notice tone="warn" className="mb-3">
          <div className="font-semibold">Some items changed since you added them.</div>
          <button onClick={fixAll} className="mt-1 font-bold underline">Update my basket</button>
        </Notice>
      )}

      <div className="space-y-2.5">
        {lines.map((l) => {
          const ql = q?.lines.find((x) => x.productId === l.productId && !x.isGift);
          const gone = q?.missingProductIds.includes(l.productId);
          return (
            <Card key={l.productId} className="flex items-center gap-3 p-3">
              <Link to={`/product/${l.productId}`} className="w-16 shrink-0">
                <ProductImage emoji={l.emoji} imageUrl={l.imageUrl} size="sm" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{l.name}</div>
                <div className="text-xs text-muted">{l.unit} · {money(ql?.unitPriceCents ?? l.priceCents)}</div>
                {gone ? (
                  <div className="text-xs font-semibold text-rose-600">No longer sold</div>
                ) : ql?.issue === 'insufficient_stock' ? (
                  <div className="text-xs font-semibold text-orange-600">Only {ql.available} left</div>
                ) : ql?.issue ? (
                  <div className="text-xs font-semibold text-rose-600">Out of stock</div>
                ) : (
                  <div className="text-sm font-bold">{money((ql?.unitPriceCents ?? l.priceCents) * l.quantity)}</div>
                )}
              </div>
              <QtyStepper size="sm" value={l.quantity} max={Math.max(1, Math.min(l.stock, 99))} onChange={(v) => setQty(l.productId, v)} />
            </Card>
          );
        })}
      </div>

      {freeMin != null && shop.data?.deliveryEnabled && (
        <Card className="mt-4">
          {subtotal >= freeMin ? (
            <p className="font-semibold">🎉 You've unlocked free delivery!</p>
          ) : (
            <>
              <p className="text-sm font-semibold">Add {money(freeMin - subtotal)} more for free delivery 🚚</p>
              <ProgressBar percent={(subtotal / freeMin) * 100} tone="brand" className="mt-2" />
            </>
          )}
        </Card>
      )}

      <Card className="mt-4 space-y-1.5">
        <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="font-semibold">{money(subtotal)}</span></div>
        <div className="flex justify-between text-sm"><span className="text-muted">Delivery & discounts</span><span className="text-muted">at checkout</span></div>
        {quote.isFetching && !q ? <Skeleton className="h-4 w-32" /> : q && q.pointsEstimate > 0 && (
          <div className="pt-1 text-sm font-semibold text-amber-600">⭐ You'll earn about {q.pointsEstimate} points</div>
        )}
      </Card>

      {q && q.minOrderRemainingCents > 0 && <Notice tone="info" className="mt-3">Add {money(q.minOrderRemainingCents)} more to reach the {money(shop.data?.minOrderCents ?? 0)} minimum order.</Notice>}

      <div className="pb-safe fixed inset-x-0 bottom-[68px] z-30 mx-auto max-w-xl px-4 pb-3">
        <Button
          block
          size="lg"
          disabled={!q || issues.length > 0 || (q?.missingProductIds.length ?? 0) > 0 || (q?.minOrderRemainingCents ?? 0) > 0}
          onClick={() => navigate('/checkout')}
          className="shadow-xl"
        >
          Checkout · {money(subtotal)}
        </Button>
      </div>
    </div>
  );
}
