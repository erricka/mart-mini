import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import type { Product } from '../lib/types';
import { ProductImage } from './ProductImage';
import { QtyStepper } from './QtyStepper';
import { Badge } from './ui';

export function StockHint({ p }: { p: Product }) {
  const { t } = useT();
  if (!p.inStock) return <span className="text-xs font-semibold text-rose-600">{t('product.out_of_stock')}</span>;
  if (p.stock <= 5) return <span className="text-xs font-semibold text-orange-600">{t('product.only_left', { n: p.stock })}</span>;
  return <span className="text-xs text-muted">{t('product.in_stock')}</span>;
}

export function ProductCard({ p, color }: { p: Product; color?: string }) {
  const { t } = useT();
  const line = useCart((s) => s.lines.find((l) => l.productId === p.id));
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  return (
    <div className="animate-rise flex flex-col rounded-3xl bg-surface p-2.5 shadow-sm ring-1 ring-line/60">
      <Link to={`/product/${p.id}`} className="relative block">
        <ProductImage emoji={p.emoji} imageUrl={p.imageUrl} color={color} className={!p.inStock ? 'opacity-50 grayscale' : ''} />
        {p.discountPercent > 0 && <Badge className="absolute left-2 top-2 bg-rose-500 text-white shadow">−{p.discountPercent}%</Badge>}
      </Link>
      <Link to={`/product/${p.id}`} className="mt-2 block px-1">
        <div className="line-clamp-2 min-h-10 text-sm font-semibold leading-tight">{p.name}</div>
        <div className="mt-0.5 text-xs text-muted">{p.unit}</div>
      </Link>
      <div className="mt-auto flex items-end justify-between gap-1 px-1 pt-2">
        <div>
          <div className="font-extrabold">{money(p.priceCents)}</div>
          {p.compareAtCents ? <div className="text-xs text-muted line-through">{money(p.compareAtCents)}</div> : <StockHint p={p} />}
        </div>
        {line ? (
          <QtyStepper size="sm" value={line.quantity} max={Math.min(p.stock, 99)} onChange={(q) => setQty(p.id, q)} />
        ) : (
          <button
            disabled={!p.inStock}
            onClick={() => {
              haptic('medium');
              add(p);
            }}
            aria-label={t('product.add_aria', { name: p.name })}
            className="grid h-10 w-10 place-items-center rounded-full bg-brand text-2xl font-bold text-brand-ink shadow-md transition active:scale-90 disabled:bg-line disabled:text-muted disabled:shadow-none"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-3xl bg-surface p-2.5 ring-1 ring-line/60">
          <div className="skeleton aspect-square rounded-2xl" />
          <div className="skeleton mt-3 h-4 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/3 rounded" />
          <div className="skeleton mt-4 h-5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
