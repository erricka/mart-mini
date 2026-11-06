import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import type { Product } from '../lib/types';
import { ProductImage } from './ProductImage';
import { QtyStepper } from './QtyStepper';
import { Plus } from 'lucide-react';
import { Badge, cx } from './ui';

export function StockHint({ p, quiet }: { p: Product; quiet?: boolean }) {
  const { t } = useT();
  if (!p.inStock) return <span className="text-xs font-semibold text-rose-600">{t('product.out_of_stock')}</span>;
  if (p.stock <= 5) return <span className="text-xs font-semibold text-orange-600">{t('product.only_left', { n: p.stock })}</span>;
  // Plenty in stock: nothing to say on cards (keeps them clean); the product page still says it.
  return quiet ? null : <span className="text-xs text-muted">{t('product.in_stock')}</span>;
}

export function ProductCard({ p }: { p: Product; color?: string }) {
  const { t } = useT();
  const line = useCart((s) => s.lines.find((l) => l.productId === p.id));
  const add = useCart((s) => s.add);
  const setQty = useCart((s) => s.setQty);
  return (
    <div className="animate-rise flex flex-col rounded-2xl bg-surface p-2">
      <div className="relative">
        <Link to={`/product/${p.id}`} className="block">
          <ProductImage emoji={p.emoji} imageUrl={p.imageUrl} className={!p.inStock ? 'opacity-50 grayscale' : ''} />
        </Link>
        {p.discountPercent > 0 && <Badge className="absolute left-1.5 top-1.5 bg-rose-500 text-white">−{p.discountPercent}%</Badge>}
        <div className="absolute bottom-1.5 right-1.5">
          {line ? (
            <div className="rounded-full shadow-sm">
              <QtyStepper size="sm" value={line.quantity} max={Math.min(p.stock, 99)} onChange={(q) => setQty(p.id, q)} />
            </div>
          ) : (
            <button
              disabled={!p.inStock}
              onClick={() => {
                haptic('medium');
                add(p);
              }}
              aria-label={t('product.add_aria', { name: p.name })}
              className="grid h-9 w-9 place-items-center rounded-full bg-brand text-brand-ink shadow-sm transition active:scale-90 disabled:bg-line disabled:text-muted"
            >
              <Plus className="h-5 w-5" strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      <Link to={`/product/${p.id}`} className="mt-2 block flex-1 px-1 pb-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cx('font-bold', !!p.compareAtCents && 'text-rose-600')}>{money(p.priceCents)}</span>
          {p.compareAtCents ? <span className="text-xs text-muted line-through">{money(p.compareAtCents)}</span> : null}
        </div>
        <div className="mt-0.5 line-clamp-2 text-sm leading-snug">{p.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {p.unit && <span>{p.unit}</span>}
          <StockHint p={p} quiet />
        </div>
      </Link>
    </div>
  );
}

export function ProductGridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-surface p-2">
          <div className="skeleton aspect-square rounded-xl" />
          <div className="skeleton mt-3 h-4 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/3 rounded" />
          <div className="skeleton mt-4 h-5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
