/**
 * "📥 Import from Excel" — bulk product upload for the catalog.
 * Reads .xlsx (read-excel-file, loaded on demand) or .csv in the browser, maps columns (English or
 * Khmer headers), shows a server-validated preview, then imports the valid rows in one go.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Badge, Button, cx, Notice, Sheet, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { toast } from '../../lib/toast';

type Field =
  | 'name' | 'nameEn' | 'sku' | 'category' | 'price' | 'compareAt' | 'stock' | 'unit'
  | 'description' | 'descriptionEn' | 'emoji' | 'imageUrl' | 'featured' | 'active';

const HEADERS: Record<Field, string[]> = {
  name: ['name_km', 'name', 'khmer_name', 'product', 'ឈ្មោះ', 'ឈ្មោះខ្មែរ', 'ឈ្មោះទំនិញ'],
  nameEn: ['name_en', 'english_name', 'english', 'ឈ្មោះអង់គ្លេស'],
  sku: ['sku', 'barcode', 'code', 'បាកូដ'],
  category: ['category', 'aisle', 'ប្រភេទ', 'ប្រភេទទំនិញ'],
  price: ['price', 'តម្លៃ'],
  compareAt: ['compare_at_price', 'was', 'was_price', 'old_price', 'តម្លៃដើម'],
  stock: ['stock', 'qty', 'quantity', 'ស្តុក', 'ចំនួន'],
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
    .replace(/[\s-]+/g, '_');

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
  if (table.length < 2) return [];
  const map = table[0].map((h) => FIELD_BY_HEADER.get(normalize(h)) ?? null);
  if (!map.includes('name')) return [];
  const out: ImportRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const r: ImportRow = { row: i + 2 };
    let any = false;
    map.forEach((field, col) => {
      if (!field) return;
      let v = cells[col] as unknown;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (v != null && String(v).trim() !== '') any = true;
      r[field] = v == null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
    });
    if (any) out.push(r);
  });
  return out;
}

interface Preview {
  dryRun: boolean;
  summary: { create: number; update: number; error: number; newCategories: string[] };
  rows: { row: number; action: 'create' | 'update' | 'error'; name: string; category: string; priceCents: number | null; stock: number | null; error?: string }[];
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

  const reset = () => {
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
      setPreview(await api<Preview>('/admin/products/import', { body: { dryRun: true, rows: parsed } }));
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
      const r = await api<Preview>('/admin/products/import', { body: { dryRun: false, rows } });
      toast(t('imp.done', { create: r.summary.create, update: r.summary.update }), 'success');
      for (const k of [['admin', 'products'], ['admin', 'categories'], ['products'], ['categories']]) qc.invalidateQueries({ queryKey: k });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const valid = preview ? preview.summary.create + preview.summary.update : 0;
  const tone = { create: 'bg-emerald-100 text-emerald-800', update: 'bg-sky-100 text-sky-800', error: 'bg-rose-100 text-rose-800' } as const;

  return (
    <Sheet open={open} onClose={close} title={t('imp.title')} wide>
      {!preview && (
        <div className="space-y-4">
          <ol className="space-y-1.5 text-sm">
            <li>{t('imp.step1')}</li>
            <li>{t('imp.step2')}</li>
            <li className="text-muted">{t('imp.step3')}</li>
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
              <span className="text-muted"> · {t('imp.summary', { create: preview.summary.create, update: preview.summary.update, error: preview.summary.error })}</span>
            </div>
            <button className="text-sm font-semibold text-brand underline" onClick={reset}>
              {t('imp.another')}
            </button>
          </div>
          {preview.summary.newCategories.length > 0 && <Notice tone="info">{t('imp.new_cats', { names: preview.summary.newCategories.join(', ') })}</Notice>}
          {preview.summary.error > 0 && <Notice tone="warn">{t('imp.errors_skipped')}</Notice>}
          <div className="max-h-[45vh] overflow-auto rounded-2xl ring-1 ring-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">{t('imp.col_row')}</th>
                  <th className="px-3 py-2">{t('imp.col_name')}</th>
                  <th className="px-3 py-2">{t('imp.col_category')}</th>
                  <th className="px-3 py-2 text-right">{t('imp.col_price')}</th>
                  <th className="px-3 py-2 text-right">{t('imp.col_stock')}</th>
                  <th className="px-3 py-2">{t('imp.col_result')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.slice(0, 300).map((r) => (
                  <tr key={r.row} className={cx(r.action === 'error' && 'bg-rose-50/60 dark:bg-rose-500/5')}>
                    <td className="px-3 py-2 text-muted">{r.row}</td>
                    <td className="px-3 py-2 font-semibold">{r.name || '—'}</td>
                    <td className="px-3 py-2">{r.category || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.priceCents != null ? money(r.priceCents) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.stock ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge className={tone[r.action]}>{t(`imp.${r.action}`)}</Badge>
                      {r.error && <div className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">{r.error}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 300 && <p className="text-xs text-muted">{t('imp.showing', { n: 300 })}</p>}
          <p className="text-xs text-muted">{t('imp.photos_hint')}</p>
          {error && <Notice tone="error">{error}</Notice>}
          <Button block size="lg" disabled={valid === 0} loading={busy === 'import'} onClick={confirm}>
            {t('imp.confirm', { n: valid })}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
