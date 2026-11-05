/**
 * "📥 Import from Excel" — bulk product upload for the catalog.
 * Reads .xlsx (read-excel-file, loaded on demand) or .csv in the browser, maps columns (English or
 * Khmer headers), shows a server-validated preview, then imports the valid rows in one go.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, cx, Notice, Sheet, Spinner } from '../../components/ui';
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
  const [showSame, setShowSame] = useState(false);
  const startStockN = Math.max(0, Math.min(1_000_000, Math.round(Number(startStock) || 0)));
  const previewFor = (r: ImportRow[], mode: 'file' | 'keep', start: number) =>
    api<Preview>('/admin/products/import', { body: { dryRun: true, rows: r, stockMode: mode, startStock: start } });

  const reset = () => {
    setRowImages(new Map());
    setUnplacedImages(0);
    setPhotoProgress(null);
    setShowSame(false);
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
  const shownRows = (preview?.rows ?? []).filter((r) => showSame || r.action !== 'same');
  const tone = {
    create: 'bg-emerald-100 text-emerald-800',
    update: 'bg-sky-100 text-sky-800',
    same: 'bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
    error: 'bg-rose-100 text-rose-800',
  } as const;
  /** "Price $3.00 → $3.25" / "Changed: name, unit". */
  const changeText = (r: PreviewRow) => {
    const other = (r.changes ?? []).filter((f) => f !== 'priceCents');
    const parts: string[] = [];
    if (r.oldPriceCents != null && r.priceCents != null) parts.push(t('imp.price_change', { from: money(r.oldPriceCents), to: money(r.priceCents) }));
    if (other.length) parts.push(t('imp.changed', { fields: other.map((f) => t(`imp.f_${f}` as TKey)).join(', ') }));
    return parts.join(' · ');
  };

  return (
    <Sheet open={open} onClose={close} title={t('imp.title')} wide>
      {!preview && (
        <div className="space-y-4">
          <ol className="space-y-1.5 text-sm">
            <li>{t('imp.step1')}</li>
            <li>{t('imp.step2')}</li>
            <li className="text-muted">{t('imp.step3')}</li>
            <li className="font-semibold text-brand">{t('imp.pos_hint')}</li>
          </ol>
          <Button variant="secondary" onClick={downloadTemplate}>
            {t('imp.template')}
          </Button>
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
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-8 text-center transition',
              dragging ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/60',
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
                <span className="text-4xl">📄</span>
                <span className="font-bold text-brand">{t('imp.choose')}</span>
                <span className="text-xs text-muted">{t('imp.drop')} · .xlsx / .csv</span>
              </>
            )}
          </label>
          <div className="rounded-2xl bg-surface-2 p-3 text-xs text-muted">
            <b className="text-ink">{t('imp.columns')}:</b> {t('imp.columns_text')}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <span className="font-semibold">📄 {fileName}</span>
              <span className="text-muted">
                {' · '}
                {t('imp.summary', { create: preview.summary.create, update: preview.summary.update, same: preview.summary.same, error: preview.summary.error })}
              </span>
            </div>
            <button className="text-sm font-semibold text-brand underline" onClick={reset}>
              {t('imp.another')}
            </button>
          </div>
          {/* Stock choice — preselected to "keep" when the file has no stock (typical POS export).
              Hidden when nothing will be written: it only matters for new or changed products. */}
          {valid > 0 && (
            <div className="space-y-2 rounded-2xl bg-surface-2 p-3.5 text-sm">
              {!preview.summary.fileHasStock && <p className="font-semibold">{t('imp.stock_none')}</p>}
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={stockMode === 'keep'} onChange={() => setStockMode('keep')} />
                <span>
                  {t('imp.stock_keep')}{' '}
                  <input
                    type="number"
                    min={0}
                    value={startStock}
                    onChange={(e) => setStartStock(e.target.value)}
                    onFocus={() => setStockMode('keep')}
                    className="mx-1 w-20 rounded-lg border border-line bg-surface px-2 py-0.5 text-center"
                    aria-label={t('imp.start_stock')}
                  />
                  {t('imp.stock_keep_after')}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={stockMode === 'file'} onChange={() => setStockMode('file')} />
                <span>{t('imp.stock_file')}</span>
              </label>
            </div>
          )}
          {preview.summary.newCategories.length > 0 && <Notice tone="info">{t('imp.new_cats', { names: preview.summary.newCategories.join(', ') })}</Notice>}
          {preview.summary.defaultCategoryCount > 0 && <Notice tone="info">{t('imp.default_cat', { n: preview.summary.defaultCategoryCount })}</Notice>}
          {preview.summary.roundedPrices > 0 && <Notice tone="info">{t('imp.rounded', { n: preview.summary.roundedPrices })}</Notice>}
          {valid > 0 && preview.summary.sharedNames.count > 0 && (
            <Notice tone="warn">{t('imp.shared_names', { n: preview.summary.sharedNames.count, examples: preview.summary.sharedNames.examples.slice(0, 3).join(', ') })}</Notice>
          )}
          {preview.summary.ignoredImages > 0 && <Notice tone="info">{t('imp.ignored_images', { n: preview.summary.ignoredImages })}</Notice>}
          {rowImages.size > 0 && (
            <div className="space-y-1.5 rounded-2xl bg-sky-50 p-3.5 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
              <p className="font-semibold">{t('imp.photos_found', { n: rowImages.size, used: photoRows.length })}</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={replacePhotos} onChange={(e) => setReplacePhotos(e.target.checked)} />
                {t('imp.replace_photos')}
              </label>
            </div>
          )}
          {unplacedImages > 0 && <Notice tone="warn">{t('imp.photos_unplaced', { n: unplacedImages })}</Notice>}
          {preview.summary.error > 0 && <Notice tone="warn">{t('imp.errors_skipped')}</Notice>}
          {valid === 0 && preview.summary.same > 0 && <Notice tone="success">{t('imp.nothing_new')}</Notice>}
          {preview.summary.same > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-sm">
              <span>{t('imp.same_skipped', { n: preview.summary.same })}</span>
              <button className="font-semibold text-brand underline" onClick={() => setShowSame((v) => !v)}>
                {showSame ? t('imp.same_hide') : t('imp.same_show')}
              </button>
            </div>
          )}
          {shownRows.length > 0 && (
            <div className="max-h-[45vh] overflow-auto rounded-2xl ring-1 ring-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="hidden px-3 py-2 sm:table-cell">{t('imp.col_row')}</th>
                    <th className="px-3 py-2">{t('imp.col_name')}</th>
                    <th className="px-3 py-2">{t('imp.col_category')}</th>
                    <th className="px-3 py-2 text-right">{t('imp.col_price')}</th>
                    <th className="px-3 py-2 text-right">{t('imp.col_stock')}</th>
                    <th className="px-3 py-2">{t('imp.col_result')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shownRows.slice(0, 300).map((r) => (
                    <tr key={r.row} className={cx(r.action === 'error' && 'bg-rose-50/60 dark:bg-rose-500/5')}>
                      <td className="hidden px-3 py-2 text-muted sm:table-cell">{r.row}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold">{r.name || '—'}</div>
                        {r.action === 'update' && <div className="mt-0.5 text-xs text-sky-800 dark:text-sky-300">{changeText(r)}</div>}
                      </td>
                      <td className="px-3 py-2">{r.category || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.priceCents != null ? money(r.priceCents) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.stock ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge className={tone[r.action]}>{t(`imp.${r.action}`)}</Badge>
                        {r.error && (
                          <div className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">
                            <span className="sm:hidden">
                              {t('imp.col_row')} {r.row} ·{' '}
                            </span>
                            {r.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shownRows.length > 300 && <p className="text-xs text-muted">{t('imp.showing', { n: 300 })}</p>}
          <p className="text-xs text-muted">{t('imp.photos_hint')}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <Button block size="lg" disabled={valid === 0} loading={busy === 'import'} onClick={confirm}>
            {photoProgress && busy === 'import' ? t('imp.uploading_photos', { done: photoProgress.done, total: photoProgress.total }) : t('imp.confirm', { n: valid })}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
