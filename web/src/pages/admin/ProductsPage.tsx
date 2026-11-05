import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ProductImage } from '../../components/ProductImage';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, Select, Sheet, Skeleton, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, fromCents, money, toCents } from '../../lib/format';
import { shrinkImage, uploadProductPhoto } from '../../lib/image';
import { toast } from '../../lib/toast';
import { translate, useT, type TKey } from '../../lib/i18n';
import { PageHeader, Td, Th } from './common';
import { ImportProducts } from './ImportProducts';
import { PhotoUploads } from './PhotoUploads';

interface AdminProduct {
  id: number;
  categoryId: number;
  name: string;
  nameEn: string | null;
  sku: string | null;
  description: string;
  descriptionEn: string | null;
  unit: string;
  priceCents: number;
  compareAtCents: number | null;
  stock: number;
  emoji: string;
  imageUrl: string | null;
  tags: string;
  active: boolean;
  featured: boolean;
}
interface AdminCategory {
  id: number;
  name: string;
  nameEn: string | null;
  slug: string;
  emoji: string;
  color: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

const useAdminCategories = () => useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api<{ categories: AdminCategory[] }>('/admin/categories').then((r) => r.categories) });

export function ProductsPage() {
  const { t } = useT();
  const cats = useAdminCategories();
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const [importOpen, setImportOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<AdminProduct> | null>(null);
  const newProduct = () => {
    setTab('products');
    setEditing({ active: true, emoji: '🛒', categoryId: cats.data?.[0]?.id });
  };
  return (
    <div>
      <PageHeader
        title={t('ap.title')}
        subtitle={t('ap.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              {t('ap.import')}
            </Button>
            <Button variant="secondary" onClick={() => setPhotosOpen(true)}>
              {t('ph.button')}
            </Button>
            <Button onClick={newProduct}>{t('ap.add_product')}</Button>
          </>
        }
      />
      <div className="mb-4 flex gap-2">
        {(['products', 'categories'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', tab === k ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>{t(k === 'products' ? 'ap.tab_products' : 'ap.tab_categories')}</button>
        ))}
      </div>
      {tab === 'products' ? <Products onNew={newProduct} onImport={() => setImportOpen(true)} /> : <Categories />}
      <ProductEditor product={editing} categories={cats.data ?? []} onClose={() => setEditing(null)} />
      <ImportProducts open={importOpen} onClose={() => setImportOpen(false)} />
      <PhotoUploads open={photosOpen} onClose={() => setPhotosOpen(false)} />
    </div>
  );
}

function Products({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stock, setStock] = useState<'all' | 'low' | 'out'>('all');
  const [noPhoto, setNoPhoto] = useState(false);
  const [editing, setEditing] = useState<Partial<AdminProduct> | null>(null);
  const [stockFor, setStockFor] = useState<AdminProduct | null>(null);
  const cats = useAdminCategories();
  const params = new URLSearchParams({ stock });
  if (noPhoto) params.set('photo', 'missing');
  if (q.trim()) params.set('q', q.trim());
  if (categoryId) params.set('categoryId', categoryId);
  const list = useQuery({
    queryKey: ['admin', 'products', q.trim(), categoryId, stock, noPhoto],
    queryFn: () => api<{ products: AdminProduct[]; summary: { total: number; out: number; low: number; noPhoto: number } }>(`/admin/products?${params}`),
    placeholderData: (p) => p,
  });
  const catOf = (id: number) => cats.data?.find((c) => c.id === id);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ap.search')} className="max-w-56 py-2" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-56 py-2">
          <option value="">{t('ap.all_categories')}</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </Select>
        {(['all', 'low', 'out'] as const).map((s) => (
          <button key={s} onClick={() => setStock(s)} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', stock === s ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
            {s === 'all' ? t('ap.filter_all', { n: list.data?.summary.total ?? '…' }) : s === 'low' ? t('ap.filter_low', { n: list.data?.summary.low ?? 0 }) : t('ap.filter_out', { n: list.data?.summary.out ?? 0 })}
          </button>
        ))}
        <button onClick={() => setNoPhoto(!noPhoto)} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', noPhoto ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
          {t('ph.filter_missing', { n: list.data?.summary.noPhoto ?? 0 })}
        </button>
      </div>

      {list.isLoading ? <Skeleton className="h-96" /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.data!.summary.total === 0 ? (
        <Card className="flex flex-col items-center py-12 text-center">
          <div className="text-6xl">🛒</div>
          <h2 className="mt-3 text-xl font-extrabold">{t('ap.empty_title')}</h2>
          <p className="mt-1 max-w-md text-sm text-muted">{t('ap.empty_text')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={onImport}>{t('ap.import')}</Button>
            <Button size="lg" variant="secondary" onClick={onNew}>{t('ap.add_product')}</Button>
          </div>
        </Card>
      ) : list.data!.products.length === 0 ? (
        <EmptyState emoji="📦" title={t('ap.no_match')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line"><tr><Th>{t('ap.col_product')}</Th><Th className="hidden md:table-cell">{t('ap.col_category')}</Th><Th>{t('ap.col_price')}</Th><Th>{t('ap.col_stock')}</Th><Th className="hidden sm:table-cell">{t('ap.col_status')}</Th><Th /></tr></thead>
            <tbody className="divide-y divide-line">
              {list.data!.products.map((p) => {
                const c = catOf(p.categoryId);
                return (
                  <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className="relative w-11 shrink-0">
                          <ProductImage emoji={p.emoji} imageUrl={p.imageUrl} color={c?.color} size="sm" />
                          {!p.imageUrl && <QuickPhoto productId={p.id} />}
                        </div>
                        <div className="min-w-0"><div className="font-semibold">{p.name}</div><div className="text-xs text-muted">{[p.nameEn, p.unit, p.sku].filter(Boolean).join(' · ')}</div></div>
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">{c ? `${c.emoji} ${c.name}` : '—'}</Td>
                    <Td><div className="font-semibold">{money(p.priceCents)}</div>{p.compareAtCents && p.compareAtCents > p.priceCents && <div className="text-xs text-muted line-through">{money(p.compareAtCents)}</div>}</Td>
                    <Td>
                      <button onClick={() => setStockFor(p)} className={cx('rounded-full px-3 py-1 font-bold', p.stock === 0 ? 'bg-rose-100 text-rose-800' : p.stock <= 5 ? 'bg-orange-100 text-orange-800' : 'bg-surface-2')}>
                        {p.stock} <span className="font-normal">± </span>
                      </button>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        <Badge className={p.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{p.active ? t('ap.visible') : t('ap.hidden')}</Badge>
                        {p.featured && <Badge className="bg-amber-100 text-amber-900">{t('ap.featured')}</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right"><Button size="sm" variant="secondary" onClick={() => setEditing(p)}>{t('common.edit')}</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <ProductEditor product={editing} categories={cats.data ?? []} onClose={() => setEditing(null)} />
      <StockSheet product={stockFor} onClose={() => setStockFor(null)} />
    </>
  );
}

function ProductEditor({ product, categories, onClose }: { product: Partial<AdminProduct> | null; categories: AdminCategory[]; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [loaded, setLoaded] = useState<Partial<AdminProduct> | null>(null);
  const [uploading, setUploading] = useState(false);
  if (product !== loaded) {
    setLoaded(product);
    setForm(product ? { ...product, price: fromCents(product.priceCents), compareAt: fromCents(product.compareAtCents), initialStock: '0' } : {});
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const priceCents = toCents(form.price ?? '');
  const save = useMutation({
    mutationFn: () => {
      const body = {
        categoryId: Number(form.categoryId),
        name: form.name ?? '',
        nameEn: form.nameEn || null,
        sku: form.sku || null,
        description: form.description ?? '',
        descriptionEn: form.descriptionEn || null,
        unit: form.unit ?? '',
        priceCents: priceCents ?? 0,
        compareAtCents: form.compareAt ? toCents(form.compareAt) : null,
        emoji: form.emoji || '🛒',
        imageUrl: form.imageUrl || null,
        tags: form.tags ?? '',
        active: form.active ?? true,
        featured: form.featured ?? false,
        ...(form.id ? {} : { stock: Number(form.initialStock) || 0 }),
      };
      return form.id ? api(`/admin/products/${form.id}`, { method: 'PUT', body }) : api('/admin/products', { body });
    },
    onSuccess: () => {
      toast(t('ap.saved'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', await shrinkImage(file));
      const r = await api<{ url: string }>('/admin/uploads', { form: fd, method: 'POST' });
      setForm((f) => ({ ...f, imageUrl: r.url }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setUploading(false);
    }
  }
  const cat = categories.find((c) => c.id === Number(form.categoryId));
  return (
    <Sheet open={!!product} onClose={onClose} title={form.id ? t('ap.edit_product') : t('ap.new_product_title')} wide>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div>
          <ProductImage emoji={form.emoji || '🛒'} imageUrl={form.imageUrl} color={cat?.color} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" variant="secondary" block className="mt-2" loading={uploading} onClick={() => fileRef.current?.click()}>{t('ap.upload')}</Button>
          {form.imageUrl && <button className="mt-1 w-full text-xs text-muted underline" onClick={() => setForm({ ...form, imageUrl: null })}>{t('ap.remove_photo')}</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('ap.name')}><Input value={form.name ?? ''} onChange={set('name')} /></Field>
          <Field label={t('ap.name_en')}><Input value={form.nameEn ?? ''} onChange={set('nameEn')} /></Field>
          <Field label={t('ap.category')}>
            <Select value={form.categoryId ?? ''} onChange={set('categoryId')}>{categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</Select>
          </Field>
          <Field label={t('ap.unit')}><Input value={form.unit ?? ''} onChange={set('unit')} placeholder={t('ap.unit_ph')} /></Field>
          <Field label={t('ap.price')} error={form.price && priceCents == null ? t('ap.price_invalid') : null}><Input inputMode="decimal" value={form.price ?? ''} onChange={set('price')} placeholder="0.00" /></Field>
          <Field label={t('ap.was')} hint={t('ap.was_hint')}><Input inputMode="decimal" value={form.compareAt ?? ''} onChange={set('compareAt')} placeholder="0.00" /></Field>
          <Field label={t('ap.emoji')}><Input value={form.emoji ?? ''} onChange={set('emoji')} maxLength={8} /></Field>
          <Field label={t('ap.sku')}><Input value={form.sku ?? ''} onChange={set('sku')} inputMode="numeric" placeholder="8850000000011" /></Field>
          {!form.id && <Field label={t('ap.start_stock')}><Input inputMode="numeric" value={form.initialStock ?? '0'} onChange={set('initialStock')} /></Field>}
          <div className="sm:col-span-2"><Field label={t('ap.description')}><Textarea value={form.description ?? ''} onChange={set('description')} /></Field></div>
          <div className="sm:col-span-2"><Field label={t('ap.description_en')}><Textarea value={form.descriptionEn ?? ''} onChange={set('descriptionEn')} /></Field></div>
          <div className="sm:col-span-2"><Field label={t('ap.tags')} hint={t('ap.tags_hint')}><Input value={form.tags ?? ''} onChange={set('tags')} placeholder={t('ap.tags_ph')} /></Field></div>
          <div className="sm:col-span-2 divide-y divide-line rounded-2xl bg-surface-2 px-4">
            <Toggle checked={form.active ?? true} onChange={(v) => setForm({ ...form, active: v })} label={t('ap.visible_toggle')} />
            <Toggle checked={form.featured ?? false} onChange={(v) => setForm({ ...form, featured: v })} label={t('ap.featured_toggle')} hint={t('ap.featured_hint')} />
          </div>
        </div>
      </div>
      <Button block size="lg" className="mt-5" loading={save.isPending} disabled={!form.name || priceCents == null || !form.categoryId} onClick={() => save.mutate()}>{t('ap.save')}</Button>
    </Sheet>
  );
}

function StockSheet({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const moves = useQuery({
    queryKey: ['admin', 'movements', product?.id],
    enabled: !!product,
    queryFn: () => api<{ movements: { id: number; delta: number; stockAfter: number; reason: string; note: string | null; orderId: number | null; createdAt: string }[] }>(`/admin/products/${product!.id}/movements`).then((r) => r.movements),
  });
  const save = useMutation({
    mutationFn: () => api(`/admin/products/${product!.id}/stock`, { body: { mode, quantity: Number(qty), note: note || null } }),
    onSuccess: () => {
      toast(t('ap.stock_saved'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['admin', 'movements'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      setQty('');
      setNote('');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!product) return null;
  const n = Number(qty);
  const result = mode === 'set' ? n : product.stock + n;
  return (
    <Sheet open onClose={onClose} title={t('ap.stock_title', { name: product.name })}>
      <div className="mb-3 text-center"><div className="text-4xl font-black">{product.stock}</div><div className="text-sm text-muted">{t('ap.in_stock_now')}</div></div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant={mode === 'add' ? 'primary' : 'secondary'} onClick={() => setMode('add')}>{t('ap.mode_add')}</Button>
        <Button variant={mode === 'set' ? 'primary' : 'secondary'} onClick={() => setMode('set')}>{t('ap.mode_set')}</Button>
      </div>
      <div className="space-y-3">
        <Field label={mode === 'add' ? t('ap.qty_add') : t('ap.qty_set')}>
          <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={mode === 'add' ? t('ap.qty_add_ph') : t('ap.qty_set_ph')} />
        </Field>
        <Field label={t('ap.note')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ap.note_ph')} /></Field>
        {qty !== '' && Number.isInteger(n) && (result < 0 ? <Notice tone="error">{t('ap.below_zero')}</Notice> : <Notice tone="info">{t('ap.new_stock', { n: result })}</Notice>)}
        <Button block loading={save.isPending} disabled={qty === '' || !Number.isInteger(n) || result < 0} onClick={() => save.mutate()}>{t('common.save')}</Button>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-bold">{t('ap.movements')}</h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {moves.data?.map((m) => (
          <li key={m.id} className="flex justify-between gap-2">
            <span className="text-muted">{dateTime(m.createdAt)} · {translate(`ap.reason_${m.reason}` as TKey)}{m.orderId ? ` #${String(m.orderId).padStart(4, '0')}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
            <span className={cx('font-bold', m.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>{m.delta > 0 ? '+' : ''}{m.delta} → {m.stockAfter}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function Categories() {
  const { t } = useT();
  const qc = useQueryClient();
  const cats = useAdminCategories();
  const [editing, setEditing] = useState<Partial<AdminCategory> | null>(null);
  const save = useMutation({
    mutationFn: (c: Partial<AdminCategory>) => {
      const body = { name: c.name, nameEn: c.nameEn || null, emoji: c.emoji || '🛒', color: c.color || '#22c55e', sortOrder: Number(c.sortOrder) || 0, active: c.active ?? true };
      return c.id ? api(`/admin/categories/${c.id}`, { method: 'PUT', body }) : api('/admin/categories', { body });
    },
    onSuccess: () => {
      toast(t('ap.cat_saved'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
      setEditing(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (cats.isLoading) return <Skeleton className="h-64" />;
  if (cats.error) return <ErrorState error={cats.error} onRetry={() => cats.refetch()} />;
  return (
    <>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEditing({ emoji: '🛒', color: '#22c55e', active: true, sortOrder: (cats.data?.length ?? 0) })}>{t('ap.new_category')}</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cats.data!.map((c) => (
          <Card key={c.id} className={cx('flex items-center gap-3', !c.active && 'opacity-60')}>
            <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl" style={{ background: `${c.color}26` }}>{c.emoji}</div>
            <div className="min-w-0 flex-1"><div className="font-bold">{c.name}</div><div className="text-xs text-muted">{c.nameEn ? `${c.nameEn} · ` : ''}{t('ap.cat_products', { n: c.productCount })}{!c.active ? t('ap.cat_hidden') : ''}</div></div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>{t('common.edit')}</Button>
          </Card>
        ))}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('ap.edit_category') : t('ap.new_category_title')}>
        {editing && (
          <div className="space-y-3">
            <Field label={t('ap.cat_name')}><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label={t('ap.cat_name_en')}><Input value={editing.nameEn ?? ''} onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('al.col_emoji')}><Input value={editing.emoji ?? ''} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} /></Field>
              <Field label={t('ap.colour')}><Input type="color" value={editing.color ?? '#22c55e'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-12 p-1" /></Field>
              <Field label={t('ap.order')}><Input inputMode="numeric" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })} /></Field>
            </div>
            <Toggle checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label={t('ap.visible_toggle')} />
            <Button block loading={save.isPending} disabled={!editing.name} onClick={() => save.mutate(editing)}>{t('ap.save_category')}</Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/** 📷 on a product without a photo: opens the phone camera (or file picker) and saves the photo. */
function QuickPhoto({ productId }: { productId: number }) {
  const { t } = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadProductPhoto(file);
      await api(`/admin/products/${productId}/photo`, { method: 'PUT', body: { imageUrl: url } });
      toast(t('ph.saved_one'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        title={t('ph.take')}
        aria-label={t('ph.take')}
        className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-brand text-xs text-brand-ink shadow ring-2 ring-surface"
      >
        {busy ? '…' : '📷'}
      </button>
    </>
  );
}
