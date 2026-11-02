import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StockHint } from '../../components/ProductCard';
import { ProductImage } from '../../components/ProductImage';
import { QtyStepper } from '../../components/QtyStepper';
import { Badge, Button, ErrorState, PageLoader } from '../../components/ui';
import { useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useProduct, useShop } from '../../lib/queries';
import { haptic } from '../../lib/telegram';
import { toast } from '../../lib/toast';

export function ProductPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const q = useProduct(id);
  const shop = useShop();
  const inCart = useCart((s) => s.lines.find((l) => l.productId === id));
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  const [qty, setLocalQty] = useState(1);

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { product: p, category } = q.data;
  const max = Math.min(p.stock, 99);
  const points = Math.floor(((p.priceCents * qty) / 100) * (shop.data?.loyalty.pointsPerDollar ?? 1));

  return (
    <div className="animate-rise">
      <button onClick={() => navigate(-1)} className="mb-3 text-sm font-semibold text-muted">← Back</button>
      <div className="relative">
        <ProductImage emoji={p.emoji} imageUrl={p.imageUrl} color={category?.color} size="xl" className={!p.inStock ? 'opacity-50 grayscale' : ''} />
        {p.discountPercent > 0 && <Badge className="absolute left-3 top-3 bg-rose-500 px-3 py-1 text-sm text-white">Save {p.discountPercent}%</Badge>}
      </div>
      {category && (
        <Link to={`/shop?category=${category.id}`} className="mt-4 inline-block text-sm font-semibold text-brand">
          {category.emoji} {category.name}
        </Link>
      )}
      <h1 className="mt-1 text-2xl font-extrabold leading-tight">{p.name}</h1>
      <p className="text-muted">{p.unit}</p>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-black">{money(p.priceCents)}</span>
        {p.compareAtCents && <span className="text-lg text-muted line-through">{money(p.compareAtCents)}</span>}
      </div>
      <div className="mt-1"><StockHint p={p} /></div>
      {p.description && <p className="mt-4 leading-relaxed text-ink/80">{p.description}</p>}

      <div className="mt-6 rounded-3xl bg-surface p-4 ring-1 ring-line/60">
        {inCart ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold">In your basket</div>
              <div className="text-sm text-muted">{money(inCart.quantity * p.priceCents)}</div>
            </div>
            <QtyStepper value={inCart.quantity} max={max} onChange={(v) => setQty(p.id, v)} />
          </div>
        ) : p.inStock ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Quantity</span>
              <QtyStepper value={qty} max={max} onChange={(v) => setLocalQty(Math.max(1, v))} />
            </div>
            <Button
              block
              size="lg"
              className="mt-4"
              onClick={() => {
                add(p, qty);
                haptic('success');
                toast(`Added ${qty} × ${p.name} 🧺`, 'success');
              }}
            >
              Add to basket · {money(p.priceCents * qty)}
            </Button>
            {points > 0 && <p className="mt-2 text-center text-xs text-muted">⭐ Earn about {points} points</p>}
          </>
        ) : (
          <p className="text-center font-semibold text-muted">Out of stock — check back soon.</p>
        )}
      </div>
    </div>
  );
}
