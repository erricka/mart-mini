/**
 * "Import from Excel" — bulk product upload for the catalog (the POS "Product List" export as it is).
 * Reads .xlsx (read-excel-file, loaded on demand) or .csv in the browser, maps columns (English or
 * Khmer headers), shows a server-validated preview, then imports the valid rows in one go.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, FileSpreadsheet, Info } from 'lucide-react';
import { Button, cx, Notice, Sheet, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';
import { uploadProductPhoto } from '../../lib/image';
import { toast } from '../../lib/toast';
import { extractXlsxImages, uploadPhotos } from '../../lib/xlsxImages';

type Field =
  | 'name' | 'nameEn' | 'sku' | 'code' | 'category' | 'price' | 'compareAt' | 'stock' | 'unit'
  | 'description' | 'descriptionEn' | 'emoji' | 'imageUrl' | 'featured' | 'active';

// Our template's columns plus common POS export names (e.g. the mart25 POS "Product List":
// Code, Name, Name2, Price, Stock Qty., Product Group …). Cost/supply price is never imported.
const HEADERS: Record<Field, string[]> = {
  name: ['name_km', 'name', 'khmer_name', 'product', 'product_name', 'item_name', 'name_kh', 'ឈ្មោះ', 'ឈ្មោះខ្មែរ', 'ឈ្មោះទំនិញ'],
  nameEn: ['name_en', 'name2', 'name_2', 'english_name', 'english', 'ឈ្មោះអង់គ្លេស'],
  sku: ['sku', 'barcode', 'bar_code', 'បាកូដ'],
  /** POS item code — used as the barcode/SKU when the Barcode column is empty. */
  code: ['code', 'item_code', 'product_code', 'លេខកូដ'],
  category: ['category', 'aisle', 'product_group', 'group', 'category_name', 'product_category', 'ប្រភេទ', 'ប្រភេទទំនិញ'],
  price: ['price', 'selling_price', 'sale_price', 'unit_price', 'retail_price', 'តម្លៃ', 'តម្លៃលក់'],
  compareAt: ['compare_at_price', 'was', 'was_price', 'old_price', 'តម្លៃដើម'],
  stock: ['stock', 'qty', 'quantity', 'stock_qty', 'stock_quantity', 'qty_on_hand', 'on_hand', 'ស្តុក', 'ចំនួន'],
  unit: ['unit', 'size', 'ខ្នាត'],
  description: ['description_km', 'description', 'ការពិពណ៌នា'],
  descriptionEn: ['description_en'],
  emoji: ['emoji'],
  imageUrl: ['image_url', 'image', 'photo', 'រូបភាព'],
  featured: ['featured', 'popular', 'ពេញនិយម'],
  active: ['active', 'visible', 'បង្ហាញ'],
};

const normalize = (h: unknown) =>
  String(h ?? '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .toLowerCase()
    // Spaces, dots and dashes all become "_" ("Stock Qty." → "stock_qty"); Khmer letters/marks stay.
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

const FIELD_BY_HEADER = new Map<string, Field>();
for (const [field, names] of Object.entries(HEADERS) as [Field, string[]][]) for (const n of names) FIELD_BY_HEADER.set(normalize(n), field);

const TEMPLATE = [
  'name_km,name_en,category,price,stock,unit,sku,compare_at_price,description_km,description_en,emoji,image_url,featured,active',
  'ចេកអំបូង,Bananas,បន្លែ និងផ្លែឈើ,1.99,60,~6 pcs,8850000000011,,ចេកទុំ ផ្អែមឆ្ងាញ់,Sweet ripe bananas,🍌,,yes,yes',
  'អង្ករផ្កាម្លិះ,Jasmine Rice,គ្រឿងទេស និងអង្ករ,6.50,40,5 kg,8850000000028,7.00,អង្ករផ្កាម្លិះខ្មែរ ក្រអូប,Fragrant Cambodian jasmine rice,🍚,,no,yes',
  'ទឹកដូង,Coconut Water,ភេសជ្ជៈ,1.99,45,1 L,,,,,🥥,,,',
].join('\r\n');

function downloadTemplate() {
  // BOM so Excel opens the Khmer text as UTF-8.
  const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mart25-products-template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Small RFC-4180-style CSV parser (quotes, embedded commas/newlines, BOM; detects , ; or tab). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = ([',', ';', '\t'] as const).map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type CellValue = string | number | boolean | null;
type ImportRow = { row: number } & Partial<Record<Field, CellValue>>;

async function readRows(file: File): Promise<ImportRow[]> {
  let table: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/universal');
    table = (await readSheet(file)) as unknown[][];
  } else {
    table = parseCsv(await file.text());
  }
  // POS exports start with a title / export date; the header row is the first one naming the product
  // and at least a price, code or group.
  const headerAt = table.slice(0, 25).findIndex((cells) => {
    const fields = new Set((cells ?? []).map((h) => FIELD_BY_HEADER.get(normalize(h))));
    return fields.has('name') && (fields.has('price') || fields.has('sku') || fields.has('code') || fields.has('category'));
  });
  if (headerAt < 0 || table.length < headerAt + 2) return [];
  const map = table[headerAt].map((h) => FIELD_BY_HEADER.get(normalize(h)) ?? null);
  const out: ImportRow[] = [];
  table.slice(headerAt + 1).forEach((cells, i) => {
    const r: ImportRow = { row: headerAt + i + 2 }; // the spreadsheet's own row number
    let any = false;
    map.forEach((field, col) => {
      if (!field) return;
      let v = (cells ?? [])[col] as unknown;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      const empty = v == null || String(v).trim() === '';
      if (empty) {
        if (!(field in r)) r[field] = null; // never let an empty column hide a filled one (Barcode vs Code)
        return;
      }
      any = true;
      r[field] = typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
    });
    // POS files: Code (and Barcode) are both sent — the shop checks either one against its SKUs.
    if (any) out.push(r);
  });
  return out;
}

interface Preview {
  dryRun: boolean;
  summary: {
    create: number;
    update: number;
    /** Already in the shop, nothing changed — skipped. */
    same: number;
    error: number;
    newCategories: string[];
    roundedPrices: number;
    ignoredImages: number;
    defaultCategoryCount: number;
    sharedNames: { count: number; examples: string[] };
    fileHasStock: boolean;
  };
  rows: PreviewRow[];
}
type ImportField =
  | 'name' | 'nameEn' | 'sku' | 'category' | 'priceCents' | 'compareAtCents' | 'unit'
  | 'description' | 'descriptionEn' | 'emoji' | 'imageUrl' | 'featured' | 'active' | 'stock';
type Tab = 'create' | 'update' | 'same' | 'error';
const TABS: Tab[] = ['create', 'update', 'same', 'error'];
interface PreviewRow {
  row: number;
  action: 'create' | 'update' | 'same' | 'error';
  name: string;
  category: string;
  priceCents: number | null;
  stock: number | null;
  hasPhoto?: boolean;
  changes?: ImportField[];
  oldPriceCents?: number;
  error?: string;
}

export function ImportProducts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'read' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Stock: POS files that don't track stock say 0 for everything — don't sell-out the whole shop.
  const [stockMode, setStockMode] = useState<'file' | 'keep'>('file');
  const [startStock, setStartStock] = useState('50');
  // Pictures inside the file (POS "Image" column), by spreadsheet row.
  const [rowImages, setRowImages] = useState<Map<number, Blob>>(new Map());
  const [unplacedImages, setUnplacedImages] = useState(0);
  const [replacePhotos, setReplacePhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<{ done: number; total: number } | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const startStockN = Math.max(0, Math.min(1_000_000, Math.round(Number(startStock) || 0)));
  const previewFor = (r: ImportRow[], mode: 'file' | 'keep', start: number) =>
    api<Preview>('/admin/products/import', { body: { dryRun: true, rows: r, stockMode: mode, startStock: start } });

  const reset = () => {
    setRowImages(new Map());
    setUnplacedImages(0);
    setPhotoProgress(null);
    setTab(null);
    setRows(null);
    setPreview(null);
    setError(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    setBusy('read');
    try {
      const parsed = await readRows(file);
      if (!parsed.length) {
        setError(t('imp.no_header'));
        return;
      }
      setRows(parsed);
      if (/\.xlsx$/i.test(file.name)) {
        const imgs = await extractXlsxImages(file).catch(() => ({ byRow: new Map<number, Blob>(), unplaced: 0 }));
        setRowImages(imgs.byRow);
        setUnplacedImages(imgs.unplaced);
      }
      let p = await previewFor(parsed, 'file', startStockN);
      if (!p.summary.fileHasStock) {
        setStockMode('keep');
        p = await previewFor(parsed, 'keep', startStockN);
      } else setStockMode('file');
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error && /fetch|reach|server/i.test(e.message) ? errorMessage(e) : t('imp.bad_file'));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!rows) return;
    setBusy('import');
    try {
      // Photos first (resized in the browser), then the import links them to their products.
      let toImport = rows;
      if (photoRows.length) {
        setPhotoProgress({ done: 0, total: photoRows.length });
        const urls = await uploadPhotos(
          photoRows.map((row) => ({ key: row, blob: rowImages.get(row)!, name: `row-${row}.${rowImages.get(row)!.type.split('/')[1] ?? 'jpg'}` })),
          uploadProductPhoto,
          (done, total) => setPhotoProgress({ done, total }),
        );
        toImport = rows.map((r) => (urls.has(r.row) ? { ...r, imageUrl: urls.get(r.row)! } : r));
      }
      const r = await api<Preview>('/admin/products/import', { body: { dryRun: false, rows: toImport, stockMode, startStock: startStockN, replacePhotos } });
      toast(t('imp.done', { create: r.summary.create, update: r.summary.update, same: r.summary.same }), 'success');
      for (const k of [['admin', 'products'], ['admin', 'categories'], ['products'], ['categories']]) qc.invalidateQueries({ queryKey: k });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Changing the stock option refreshes the preview.
  useEffect(() => {
    if (!rows || !preview) return;
    const timer = setTimeout(() => {
      previewFor(rows, stockMode, startStockN)
        .then(setPreview)
        .catch((e) => setError(errorMessage(e)));
    }, 400);
    return () => clearTimeout(timer);
  }, [stockMode, startStockN]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows whose picture will be used: valid rows, and (unless replacing) products without a photo yet.
  const photoRows = (preview?.rows ?? []).filter((r) => r.action !== 'error' && rowImages.has(r.row) && (!r.hasPhoto || replacePhotos)).map((r) => r.row);
  // What will be written: new and changed products, plus products already in the shop that get a photo.
  const photoOnly = (preview?.rows ?? []).filter((r) => r.action === 'same' && photoRows.includes(r.row)).length;
  const valid = preview ? preview.summary.create + preview.summary.update + photoOnly : 0;
  const counts: Record<Tab, number> = preview
    ? { create: preview.summary.create, update: preview.summary.update, same: preview.summary.same, error: preview.summary.error }
    : { create: 0, update: 0, same: 0, error: 0 };
  // The list shows one group at a time (picked with the count tiles).
  const activeTab: Tab = tab && counts[tab] > 0 ? tab : (TABS.find((k) => k !== 'same' && counts[k] > 0) ?? 'same');
  const listRows = (preview?.rows ?? []).filter((r) => r.action === activeTab);
  /** "Price $3.00 → $3.25" / "Changed: name, unit". */
  const changeText = (r: PreviewRow) => {
    const other = (r.changes ?? []).filter((f) => f !== 'priceCents');
    const parts: string[] = [];
    if (r.oldPriceCents != null && r.priceCents != null) parts.push(t('imp.price_change', { from: money(r.oldPriceCents), to: money(r.priceCents) }));
    if (other.length) parts.push(t('imp.changed', { fields: other.map((f) => t(`imp.f_${f}` as TKey)).join(', ') }));
    return parts.join(' · ');
  };
  const notes = preview
    ? [
        preview.summary.newCategories.length > 0 && t('imp.new_cats', { names: preview.summary.newCategories.join(', ') }),
        preview.summary.defaultCategoryCount > 0 && t('imp.default_cat', { n: preview.summary.defaultCategoryCount }),
        preview.summary.roundedPrices > 0 && t('imp.rounded', { n: preview.summary.roundedPrices }),
        preview.summary.sharedNames.count > 0 &&
          t('imp.shared_names', { n: preview.summary.sharedNames.count, examples: preview.summary.sharedNames.examples.slice(0, 3).join(', ') }),
        preview.summary.ignoredImages > 0 && t('imp.ignored_images', { n: preview.summary.ignoredImages }),
        unplacedImages > 0 && t('imp.photos_unplaced', { n: unplacedImages }),
      ].filter((x): x is string => !!x)
    : [];

  return (
    <Sheet open={open} onClose={close} title={t('imp.title')} wide>
      {!preview && (
        <div className="space-y-4">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFile(f);
            }}
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-10 text-center transition',
              dragging ? 'border-brand bg-brand/5' : 'border-line bg-surface-2/60 hover:border-brand/60',
            )}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />
            {busy === 'read' ? (
              <>
                <Spinner className="h-6 w-6 text-brand" />
                <span className="text-sm text-muted">{t('imp.reading')}</span>
              </>
            ) : (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand">
                  <FileSpreadsheet className="h-6 w-6" strokeWidth={1.75} />
                </span>
                <span className="font-bold">{t('imp.choose')}</span>
                <span className="text-sm text-muted">{t('imp.drop')}</span>
              </>
            )}
          </label>
          <p className="text-sm text-muted">{t('imp.pos_hint')}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <details className="group text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-muted">
              <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
              {t('imp.own_sheet')}
            </summary>
            <div className="mt-2 space-y-2 pl-5 text-muted">
              <p>{t('imp.step3')}</p>
              <p>
                <b className="text-ink">{t('imp.columns')}:</b> {t('imp.columns_text')}
              </p>
              <button className="font-semibold text-brand" onClick={downloadTemplate}>
                {t('imp.template')}
              </button>
            </div>
          </details>
        </div>
      )}

      {preview && (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-semibold">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted" />
              <span className="truncate">{fileName}</span>
            </span>
            <button className="shrink-0 font-semibold text-brand" onClick={reset}>
              {t('imp.another')}
            </button>
          </div>

          {/* Counts — also pick which group the list shows. */}
          <div className="grid grid-cols-4 gap-2">
            {TABS.map((k) => (
              <button
                key={k}
                onClick={() => counts[k] > 0 && setTab(k)}
                disabled={counts[k] === 0}
                className={cx(
                  'rounded-2xl px-2 py-3 text-center transition',
                  activeTab === k && counts[k] > 0 ? 'bg-surface ring-2 ring-ink/80' : 'bg-surface-2',
                  counts[k] === 0 && 'opacity-50',
                )}
              >
                <span className={cx('block text-xl font-bold tabular-nums', k === 'error' && counts[k] > 0 && 'text-rose-600')}>{counts[k]}</span>
                <span className="block text-xs leading-tight text-muted">{t(`imp.tile_${k}`)}</span>
              </button>
            ))}
          </div>

          {valid === 0 ? (
            <div className="flex flex-col items-center px-4 py-4 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand">
                <Check className="h-6 w-6" strokeWidth={2.5} />
              </span>
              <h3 className="mt-3 font-bold">{counts.same > 0 ? t('imp.all_in_shop_title') : t('imp.nothing_to_upload')}</h3>
              <p className="mt-1 text-sm text-muted">{counts.same > 0 ? t('imp.all_in_shop_text') : t('imp.fix_and_retry')}</p>
            </div>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-bold">{t('imp.stock_title')}</h3>
                {!preview.summary.fileHasStock && <p className="text-sm text-muted">{t('imp.stock_none')}</p>}
                <label className="flex items-center gap-3 text-sm">
                  <input type="radio" className="h-4 w-4 accent-[var(--brand)]" checked={stockMode === 'keep'} onChange={() => setStockMode('keep')} />
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {t('imp.stock_keep')}
                    <input
                      type="number"
                      min={0}
                      value={startStock}
                      onChange={(e) => setStartStock(e.target.value)}
                      onFocus={() => setStockMode('keep')}
                      className="w-16 rounded-lg border border-line bg-surface px-2 py-0.5 text-center"
                      aria-label={t('imp.start_stock')}
                    />
                    {t('imp.stock_keep_after')}
                  </span>
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <input type="radio" className="h-4 w-4 accent-[var(--brand)]" checked={stockMode === 'file'} onChange={() => setStockMode('file')} />
                  {t('imp.stock_file')}
                </label>
              </section>

              {rowImages.size > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-bold">{t('imp.photos_title')}</h3>
                  <p className="text-sm text-muted">{t('imp.photos_found', { n: rowImages.size, used: photoRows.length })}</p>
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={replacePhotos} onChange={(e) => setReplacePhotos(e.target.checked)} />
                    {t('imp.replace_photos')}
                  </label>
                </section>
              )}

              {notes.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-bold">{t('imp.notes_title')}</h3>
                  <ul className="space-y-1.5 text-sm text-muted">
                    {notes.map((n) => (
                      <li key={n} className="flex gap-2">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{n}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* The rows of the selected group. */}
          {listRows.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-bold">
                {t(`imp.tile_${activeTab}`)} · {listRows.length}
              </h3>
              {activeTab === 'error' && <p className="text-sm text-muted">{t('imp.errors_skipped')}</p>}
              <ul className="max-h-[40vh] divide-y divide-line overflow-auto rounded-2xl ring-1 ring-line">
                {listRows.slice(0, 300).map((r) => (
                  <li key={r.row} className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{r.name || '—'}</div>
                      <div className="text-xs text-muted">
                        {activeTab === 'error' ? (
                          <span className="text-rose-600">
                            {t('imp.row', { row: r.row })} · {r.error}
                          </span>
                        ) : activeTab === 'update' ? (
                          changeText(r)
                        ) : (
                          [r.category, r.stock != null && activeTab === 'create' ? t('imp.in_stock', { n: r.stock }) : null].filter(Boolean).join(' · ')
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums">{r.priceCents != null ? money(r.priceCents) : '—'}</span>
                  </li>
                ))}
              </ul>
              {listRows.length > 300 && <p className="text-xs text-muted">{t('imp.showing', { n: 300 })}</p>}
            </section>
          )}

          {error && <Notice tone="error">{error}</Notice>}
          {valid === 0 ? (
            <Button block size="lg" variant="secondary" onClick={close}>
              {t('imp.done_btn')}
            </Button>
          ) : (
            <Button block size="lg" loading={busy === 'import'} onClick={confirm}>
              {photoProgress && busy === 'import' ? t('imp.uploading_photos', { done: photoProgress.done, total: photoProgress.total }) : t('imp.confirm', { n: valid })}
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
