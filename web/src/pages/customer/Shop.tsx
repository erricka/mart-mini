import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProductCard, ProductGridSkeleton } from '../../components/ProductCard';
import { Button, cx, EmptyState, ErrorState } from '../../components/ui';
import { useCategories, useProducts } from '../../lib/queries';

export function Shop() {
  const [params, setParams] = useSearchParams();
  const categoryId = Number(params.get('category')) || undefined;
  const promo = params.get('promo') === '1';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  const cats = useCategories();
  const products = useProducts({ categoryId, q: debounced || undefined, promo, limit: 200 });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (params.get('focus') === '1') inputRef.current?.focus();
  }, [params]);

  const select = (id?: number, isPromo = false) => {
    const next = new URLSearchParams();
    if (id) next.set('category', String(id));
    if (isPromo) next.set('promo', '1');
    setParams(next, { replace: true });
  };
  const colorOf = (id: number) => cats.data?.find((c) => c.id === id)?.color;
  const current = cats.data?.find((c) => c.id === categoryId);

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 bg-bg/95 px-4 pb-3 pt-1 backdrop-blur">
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight">{current ? `${current.emoji} ${current.name}` : promo ? '🔥 Deals' : 'Shop'}</h1>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            enterKeyHint="search"
            placeholder="Search products"
            className="w-full rounded-2xl border border-line bg-surface py-3.5 pl-11 pr-10 outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-surface-2 text-sm" aria-label="Clear search">
              ✕
            </button>
          )}
        </div>
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <Chip active={!categoryId && !promo} onClick={() => select()}>All</Chip>
          <Chip active={promo} onClick={() => select(undefined, true)}>🔥 Deals</Chip>
          {cats.data?.map((c) => (
            <Chip key={c.id} active={c.id === categoryId} onClick={() => select(c.id)}>
              {c.emoji} {c.name}
            </Chip>
          ))}
        </div>
      </div>

      {products.isLoading ? (
        <ProductGridSkeleton n={6} />
      ) : products.error ? (
        <ErrorState error={products.error} onRetry={() => products.refetch()} />
      ) : products.data!.length === 0 ? (
        <EmptyState
          emoji="🔎"
          title={debounced ? `No results for “${debounced}”` : 'Nothing here yet'}
          text={debounced ? 'Try another word, or browse all aisles.' : 'Check back soon — we restock daily.'}
          action={<Button variant="secondary" onClick={() => { setQ(''); select(); }}>Browse everything</Button>}
        />
      ) : (
        <div className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3', products.isFetching && 'opacity-70 transition')}>
          {products.data!.map((p) => (
            <ProductCard key={p.id} p={p} color={colorOf(p.categoryId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx('shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition', active ? 'bg-ink text-bg' : 'bg-surface text-ink ring-1 ring-line')}
    >
      {children}
    </button>
  );
}
