import { ChevronLeft, Star } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StockHint } from '../../components/ProductCard';
import { ProductImage } from '../../components/ProductImage';
import { QtyStepper } from '../../components/QtyStepper';
import { Badge, Button, ErrorState, PageLoader } from '../../components/ui';
import { useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useProduct, useShop } from '../../lib/queries';
import { haptic } from '../../lib/telegram';
import { toast } from '../../lib/toast';

export function ProductPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { t } = useT();
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
      <button onClick={() => navigate(-1)} className="-ml-1 mb-3 flex items-center gap-0.5 text-sm font-semibold text-muted">
        <ChevronLeft className="h-5 w-5" />
        {t('common.back')}
      </button>
      <div className="relative rounded-2xl bg-surface p-3">
        <ProductImage emoji={p.emoji} imageUrl={p.imageUrl} size="xl" className={!p.inStock ? 'opacity-50 grayscale' : ''} />
        {p.discountPercent > 0 && <Badge className="absolute left-5 top-5 bg-rose-500 px-2.5 py-1 text-white">{t('product.save_pct', { n: p.discountPercent })}</Badge>}
      </div>
      <div className="mt-3 rounded-2xl bg-surface p-4">
        {category && (
          <Link to={`/shop?category=${category.id}`} className="text-sm font-medium text-brand">
            {category.name}
          </Link>
        )}
        <h1 className="mt-0.5 text-xl font-bold leading-snug">{p.name}</h1>
        {p.unit && <p className="text-sm text-muted">{p.unit}</p>}
        <div className="mt-3 flex items-baseline gap-2">
          <span className={p.compareAtCents ? 'text-2xl font-bold text-rose-600' : 'text-2xl font-bold'}>{money(p.priceCents)}</span>
          {p.compareAtCents && <span className="text-muted line-through">{money(p.compareAtCents)}</span>}
        </div>
        <div className="mt-1"><StockHint p={p} /></div>
        {p.description && <p className="mt-3 text-[15px] leading-relaxed text-ink/80">{p.description}</p>}
      </div>

      <div className="mt-3 rounded-2xl bg-surface p-4">
        {inCart ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold">{t('product.in_basket')}</div>
              <div className="text-sm text-muted">{money(inCart.quantity * p.priceCents)}</div>
            </div>
            <QtyStepper value={inCart.quantity} max={max} onChange={(v) => setQty(p.id, v)} />
          </div>
        ) : p.inStock ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-semibold">{t('product.quantity')}</span>
              <QtyStepper value={qty} max={max} onChange={(v) => setLocalQty(Math.max(1, v))} />
            </div>
            <Button
              block
              size="lg"
              className="mt-4"
              onClick={() => {
                add(p, qty);
                haptic('success');
                toast(t('product.added', { qty, name: p.name }), 'success');
              }}
            >
              {t('product.add_to_basket', { amount: money(p.priceCents * qty) })}
            </Button>
            {points > 0 && (
              <p className="mt-2.5 flex items-center justify-center gap-1 text-xs text-muted">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {t('product.earn_about', { n: points })}
              </p>
            )}
          </>
        ) : (
          <p className="text-center font-semibold text-muted">{t('product.oos_soon')}</p>
        )}
      </div>
    </div>
  );
}
