import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ProductImage } from '../../components/ProductImage';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Notice, Select, Sheet, Skeleton, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { dateTime, fromCents, money, toCents } from '../../lib/format';
import { toast } from '../../lib/toast';
import { PageHeader, Td, Th } from './common';

interface AdminProduct {
  id: number;
  categoryId: number;
  name: string;
  description: string;
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
  slug: string;
  emoji: string;
  color: string;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

const useAdminCategories = () => useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api<{ categories: AdminCategory[] }>('/admin/categories').then((r) => r.categories) });

export function ProductsPage() {
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  return (
    <div>
      <PageHeader title="Catalog" subtitle="Products, prices, photos and stock. Changes show in the shop immediately." />
      <div className="mb-4 flex gap-2">
        {(['products', 'categories'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-full px-4 py-1.5 text-sm font-semibold capitalize', tab === t ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>{t}</button>
        ))}
      </div>
      {tab === 'products' ? <Products /> : <Categories />}
    </div>
  );
}

function Products() {
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stock, setStock] = useState<'all' | 'low' | 'out'>('all');
  const [editing, setEditing] = useState<Partial<AdminProduct> | null>(null);
  const [stockFor, setStockFor] = useState<AdminProduct | null>(null);
  const cats = useAdminCategories();
  const params = new URLSearchParams({ stock });
  if (q.trim()) params.set('q', q.trim());
  if (categoryId) params.set('categoryId', categoryId);
  const list = useQuery({
    queryKey: ['admin', 'products', q.trim(), categoryId, stock],
    queryFn: () => api<{ products: AdminProduct[]; summary: { total: number; out: number; low: number } }>(`/admin/products?${params}`),
    placeholderData: (p) => p,
  });
  const catOf = (id: number) => cats.data?.find((c) => c.id === id);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="max-w-56 py-2" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-48 py-2">
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </Select>
        {(['all', 'low', 'out'] as const).map((s) => (
          <button key={s} onClick={() => setStock(s)} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold', stock === s ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
            {s === 'all' ? `All (${list.data?.summary.total ?? '…'})` : s === 'low' ? `Low stock (${list.data?.summary.low ?? 0})` : `Out of stock (${list.data?.summary.out ?? 0})`}
          </button>
        ))}
        <Button className="ml-auto" onClick={() => setEditing({ active: true, emoji: '🛒', categoryId: cats.data?.[0]?.id })}>+ New product</Button>
      </div>

      {list.isLoading ? <Skeleton className="h-96" /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : list.data!.products.length === 0 ? (
        <EmptyState emoji="📦" title="No products match" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line"><tr><Th>Product</Th><Th className="hidden md:table-cell">Category</Th><Th>Price</Th><Th>Stock</Th><Th className="hidden sm:table-cell">Status</Th><Th /></tr></thead>
            <tbody className="divide-y divide-line">
              {list.data!.products.map((p) => {
                const c = catOf(p.categoryId);
                return (
                  <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <div className="w-11 shrink-0"><ProductImage emoji={p.emoji} imageUrl={p.imageUrl} color={c?.color} size="sm" /></div>
                        <div className="min-w-0"><div className="font-semibold">{p.name}</div><div className="text-xs text-muted">{p.unit}</div></div>
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
                        <Badge className={p.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}>{p.active ? 'Visible' : 'Hidden'}</Badge>
                        {p.featured && <Badge className="bg-amber-100 text-amber-900">⭐ Featured</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right"><Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button></Td>
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
        description: form.description ?? '',
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
      toast('Product saved ✓', 'success');
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
      fd.append('file', file);
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
    <Sheet open={!!product} onClose={onClose} title={form.id ? 'Edit product' : 'New product'} wide>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div>
          <ProductImage emoji={form.emoji || '🛒'} imageUrl={form.imageUrl} color={cat?.color} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="sm" variant="secondary" block className="mt-2" loading={uploading} onClick={() => fileRef.current?.click()}>📷 Upload photo</Button>
          {form.imageUrl && <button className="mt-1 w-full text-xs text-muted underline" onClick={() => setForm({ ...form, imageUrl: null })}>Remove photo</button>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Name"><Input value={form.name ?? ''} onChange={set('name')} /></Field></div>
          <Field label="Category">
            <Select value={form.categoryId ?? ''} onChange={set('categoryId')}>{categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</Select>
          </Field>
          <Field label="Unit / size"><Input value={form.unit ?? ''} onChange={set('unit')} placeholder="e.g. 1 kg, 6 pack" /></Field>
          <Field label="Price" error={form.price && priceCents == null ? 'Enter a valid price' : null}><Input inputMode="decimal" value={form.price ?? ''} onChange={set('price')} placeholder="0.00" /></Field>
          <Field label="Was (promo, optional)" hint="Shown struck through when higher than the price."><Input inputMode="decimal" value={form.compareAt ?? ''} onChange={set('compareAt')} placeholder="0.00" /></Field>
          <Field label="Emoji (used when there is no photo)"><Input value={form.emoji ?? ''} onChange={set('emoji')} maxLength={8} /></Field>
          {!form.id && <Field label="Starting stock"><Input inputMode="numeric" value={form.initialStock ?? '0'} onChange={set('initialStock')} /></Field>}
          <div className="sm:col-span-2"><Field label="Description"><Textarea value={form.description ?? ''} onChange={set('description')} /></Field></div>
          <div className="sm:col-span-2"><Field label="Search tags" hint="Extra words customers might search for."><Input value={form.tags ?? ''} onChange={set('tags')} placeholder="fruit, organic" /></Field></div>
          <div className="sm:col-span-2 divide-y divide-line rounded-2xl bg-surface-2 px-4">
            <Toggle checked={form.active ?? true} onChange={(v) => setForm({ ...form, active: v })} label="Visible in shop" />
            <Toggle checked={form.featured ?? false} onChange={(v) => setForm({ ...form, featured: v })} label="Featured on home" hint="Shows under “Popular picks”." />
          </div>
        </div>
      </div>
      <Button block size="lg" className="mt-5" loading={save.isPending} disabled={!form.name || priceCents == null || !form.categoryId} onClick={() => save.mutate()}>Save product</Button>
    </Sheet>
  );
}

function StockSheet({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
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
      toast('Stock updated ✓', 'success');
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
    <Sheet open onClose={onClose} title={`Stock · ${product.name}`}>
      <div className="mb-3 text-center"><div className="text-4xl font-black">{product.stock}</div><div className="text-sm text-muted">in stock now</div></div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button variant={mode === 'add' ? 'primary' : 'secondary'} onClick={() => setMode('add')}>➕ Delivery / adjust</Button>
        <Button variant={mode === 'set' ? 'primary' : 'secondary'} onClick={() => setMode('set')}>🔢 Stock count</Button>
      </div>
      <div className="space-y-3">
        <Field label={mode === 'add' ? 'Quantity to add (negative to remove)' : 'Counted quantity on the shelf'}>
          <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={mode === 'add' ? 'e.g. 24 or -2' : 'e.g. 18'} />
        </Field>
        <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Supplier delivery, damaged items" /></Field>
        {qty !== '' && Number.isInteger(n) && (result < 0 ? <Notice tone="error">Stock can't go below zero.</Notice> : <Notice tone="info">New stock will be <b>{result}</b>.</Notice>)}
        <Button block loading={save.isPending} disabled={qty === '' || !Number.isInteger(n) || result < 0} onClick={() => save.mutate()}>Save</Button>
      </div>
      <h3 className="mb-2 mt-5 text-sm font-bold">Recent movements</h3>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
        {moves.data?.map((m) => (
          <li key={m.id} className="flex justify-between gap-2">
            <span className="text-muted">{dateTime(m.createdAt)} · {m.reason}{m.orderId ? ` #${String(m.orderId).padStart(4, '0')}` : ''}{m.note ? ` · ${m.note}` : ''}</span>
            <span className={cx('font-bold', m.delta > 0 ? 'text-emerald-600' : 'text-rose-600')}>{m.delta > 0 ? '+' : ''}{m.delta} → {m.stockAfter}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function Categories() {
  const qc = useQueryClient();
  const cats = useAdminCategories();
  const [editing, setEditing] = useState<Partial<AdminCategory> | null>(null);
  const save = useMutation({
    mutationFn: (c: Partial<AdminCategory>) => {
      const body = { name: c.name, emoji: c.emoji || '🛒', color: c.color || '#22c55e', sortOrder: Number(c.sortOrder) || 0, active: c.active ?? true };
      return c.id ? api(`/admin/categories/${c.id}`, { method: 'PUT', body }) : api('/admin/categories', { body });
    },
    onSuccess: () => {
      toast('Category saved ✓', 'success');
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
      <div className="mb-3 flex justify-end"><Button onClick={() => setEditing({ emoji: '🛒', color: '#22c55e', active: true, sortOrder: (cats.data?.length ?? 0) })}>+ New category</Button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cats.data!.map((c) => (
          <Card key={c.id} className={cx('flex items-center gap-3', !c.active && 'opacity-60')}>
            <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl" style={{ background: `${c.color}26` }}>{c.emoji}</div>
            <div className="min-w-0 flex-1"><div className="font-bold">{c.name}</div><div className="text-xs text-muted">{c.productCount} products{!c.active ? ' · hidden' : ''}</div></div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
          </Card>
        ))}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit category' : 'New category'}>
        {editing && (
          <div className="space-y-3">
            <Field label="Name"><Input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Emoji"><Input value={editing.emoji ?? ''} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} /></Field>
              <Field label="Colour"><Input type="color" value={editing.color ?? '#22c55e'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-12 p-1" /></Field>
              <Field label="Order"><Input inputMode="numeric" value={editing.sortOrder ?? 0} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })} /></Field>
            </div>
            <Toggle checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Visible in shop" />
            <Button block loading={save.isPending} disabled={!editing.name} onClick={() => save.mutate(editing)}>Save category</Button>
          </div>
        )}
      </Sheet>
    </>
  );
}
