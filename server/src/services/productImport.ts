/**
 * Bulk product import (from the dashboard's Excel/CSV upload).
 * The browser turns the spreadsheet into rows; this service validates every row, matches existing
 * products (by barcode/SKU, otherwise by Khmer name), auto-creates unknown aisles and — unless it is
 * a dry run — applies everything in one transaction with audited stock movements.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { categories, inventoryMovements, products, type Product } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { tr } from '../lib/i18n.js';
import { isPhotoUrl } from './media.js';

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

export const importSchema = z.object({
  dryRun: z.boolean().default(true),
  /**
   * 'file' = use each row's stock (empty cell keeps the current stock).
   * 'keep' = ignore the file's stock (e.g. a POS export that doesn't track stock and says 0 for
   *          everything): existing products keep their stock, new products start with startStock.
   */
  stockMode: z.enum(['file', 'keep']).default('file'),
  startStock: z.number().int().min(0).max(1_000_000).default(0),
  /** Photos from the file replace a product's existing photo only when true. */
  replacePhotos: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        row: z.number().int(),
        sku: cell,
        name: cell,
        nameEn: cell,
        category: cell,
        price: cell,
        compareAt: cell,
        stock: cell,
        unit: cell,
        description: cell,
        descriptionEn: cell,
        emoji: cell,
        imageUrl: cell,
        featured: cell,
        active: cell,
      }),
    )
    .max(5000),
});

type Cell = string | number | boolean | null | undefined;
const text = (v: Cell) => (v == null ? '' : String(v).trim());

/** "1.99", "$1.99", "1,234.50", "1,99", "4000៛" → cents. */
export function parseMoney(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  let s = text(v).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function parseBool(v: Cell): boolean | undefined {
  const s = text(v).toLowerCase();
  if (!s) return undefined;
  if (['1', 'true', 'yes', 'y', 'x', '✓', 'បាទ', 'ចាស', 'មាន'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'ទេ', 'គ្មាន'].includes(s)) return false;
  return undefined;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);

export interface ImportRowResult {
  row: number;
  action: 'create' | 'update' | 'error';
  name: string;
  category: string;
  priceCents: number | null;
  stock: number | null;
  /** The matched product already has a photo (kept unless replacePhotos). */
  hasPhoto?: boolean;
  error?: string;
}

/** Products without a group/category in the file go here (created when needed). */
export const DEFAULT_CATEGORY = { name: 'ផ្សេងៗ', nameEn: 'Other' };

export async function importProducts(input: z.infer<typeof importSchema>, actorUserId: number) {
  if (input.rows.length > 2000) throw badRequest('too_many_rows', tr('imp.too_many'));

  const [allProducts, allCategories] = await Promise.all([db.select().from(products), db.select().from(categories)]);
  const bySku = new Map(allProducts.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
  const nameKey = (s: string) => s.trim().toLowerCase();
  const byName = new Map<string, Product[]>();
  for (const p of allProducts) byName.set(nameKey(p.name), [...(byName.get(nameKey(p.name)) ?? []), p]);
  const catKey = (s: string) => s.trim().toLowerCase();
  const catLookup = new Map<string, number>();
  const catEmoji = new Map(allCategories.map((c) => [c.id, c.emoji]));
  for (const c of allCategories) {
    catLookup.set(catKey(c.name), c.id);
    if (c.nameEn) catLookup.set(catKey(c.nameEn), c.id);
    catLookup.set(catKey(c.slug), c.id);
  }
  // POS files often reuse one name for several sizes/scents (different barcodes).
  const namesInFile = new Map<string, number>();
  for (const r of input.rows) {
    const n = nameKey(text(r.name));
    if (n) namesInFile.set(n, (namesInFile.get(n) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const claimed = new Map<number, number>(); // existing product id → row that updates it
  const newCategories = new Set<string>();
  const results: ImportRowResult[] = [];
  const plan: { row: number; existing: Product | null; category: string; values: Record<string, unknown>; stock: number | null }[] = [];
  let roundedPrices = 0;
  let ignoredImages = 0;
  let defaultCategoryCount = 0;
  // Rows that will be imported but share their name with another row (examples keyed by lower-case name).
  let sharedNameRows = 0;
  const sharedNames = new Map<string, string>();
  const keepStock = input.stockMode === 'keep';

  for (const r of input.rows) {
    const name = text(r.name);
    const sku = text(r.sku);
    const priceCents = parseMoney(r.price);
    const stockText = text(r.stock);
    const fileStock = stockText === '' ? null : Number(stockText.replace(/,/g, ''));
    const base = { row: r.row, name, category: text(r.category), priceCents, stock: fileStock != null && Number.isInteger(fileStock) ? fileStock : null };
    const fail = (error: string) => results.push({ ...base, action: 'error', error });

    if (!name) {
      fail(tr('imp.name_required'));
      continue;
    }
    // A barcode/code identifies the product. The name is only used to attach a code to a product that
    // was created by hand without one — and only when that's unambiguous.
    let existing: Product | null = null;
    if (sku) {
      existing = bySku.get(sku.toLowerCase()) ?? null;
      if (!existing && namesInFile.get(nameKey(name)) === 1) {
        const same = byName.get(nameKey(name)) ?? [];
        if (same.length === 1 && !same[0].sku) existing = same[0];
      }
    } else {
      existing = (byName.get(nameKey(name)) ?? [])[0] ?? null;
    }
    let category = text(r.category);
    const usesDefaultCategory = !category && !existing;
    if (usesDefaultCategory) category = DEFAULT_CATEGORY.name;
    if (priceCents == null && !existing) {
      fail(tr('imp.price_invalid'));
      continue;
    }
    const compareText = text(r.compareAt);
    const compareAtCents = compareText ? parseMoney(r.compareAt) : null;
    if (compareText && compareAtCents == null) {
      fail(tr('imp.compare_invalid'));
      continue;
    }
    if (!keepStock && fileStock != null && (!Number.isInteger(fileStock) || fileStock < 0)) {
      fail(tr('imp.stock_invalid'));
      continue;
    }
    const key = sku ? `sku:${sku.toLowerCase()}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) {
      fail(tr('imp.duplicate', { row: seen.get(key)! }));
      continue;
    }
    if (existing && claimed.has(existing.id)) {
      fail(tr('imp.duplicate', { row: claimed.get(existing.id)! }));
      continue;
    }
    seen.set(key, r.row);
    if (existing) claimed.set(existing.id, r.row);
    if (category && !catLookup.has(catKey(category))) newCategories.add(category);
    if (usesDefaultCategory) defaultCategoryCount++;
    if ((namesInFile.get(nameKey(name)) ?? 0) > 1) {
      sharedNameRows++;
      if (!sharedNames.has(nameKey(name))) sharedNames.set(nameKey(name), name);
    }
    const rawPrice = typeof r.price === 'number' ? r.price : Number(text(r.price).replace(/[^\d.]/g, ''));
    if (Number.isFinite(rawPrice) && Math.abs(rawPrice * 100 - Math.round(rawPrice * 100)) > 1e-6) roundedPrices++;

    // Empty cells mean "keep what's there" when updating.
    const values: Record<string, unknown> = { name };
    if (sku) values.sku = sku;
    if (text(r.nameEn)) values.nameEn = text(r.nameEn);
    if (priceCents != null) values.priceCents = priceCents;
    if (compareText) values.compareAtCents = compareAtCents;
    if (text(r.unit)) values.unit = text(r.unit);
    if (text(r.description)) values.description = text(r.description);
    if (text(r.descriptionEn)) values.descriptionEn = text(r.descriptionEn);
    if (text(r.emoji)) values.emoji = text(r.emoji).slice(0, 16);
    const imageUrl = text(r.imageUrl);
    if (imageUrl && isPhotoUrl(imageUrl)) {
      if (!existing?.imageUrl || input.replacePhotos) values.imageUrl = imageUrl;
    }
    else if (imageUrl) ignoredImages++; // e.g. a file name from the POS — add the photo in the dashboard
    const featured = parseBool(r.featured);
    const active = parseBool(r.active);
    if (featured !== undefined) values.featured = featured;
    if (active !== undefined) values.active = active;

    // Stock to set (null = leave the current stock).
    const stock = keepStock ? (existing ? null : input.startStock) : base.stock;
    plan.push({ row: r.row, existing, category, values, stock });
    results.push({
      ...base,
      category,
      stock: stock ?? existing?.stock ?? 0,
      hasPhoto: !!existing?.imageUrl,
      action: existing ? 'update' : 'create',
    });
  }

  const summary = {
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    error: results.filter((r) => r.action === 'error').length,
    newCategories: [...newCategories],
    /** Prices with more than 2 decimals (e.g. 3.125 from riel) — rounded to the cent. */
    roundedPrices,
    /** Image cells that weren't https links (ignored). */
    ignoredImages,
    /** Products put in the default category because the file had none. */
    defaultCategoryCount,
    /** Names used by more than one product in the file (customers can't tell them apart). */
    sharedNames: { count: sharedNameRows, examples: [...sharedNames.values()].slice(0, 5) },
    /** False when every row says 0 / empty stock — typical for POS files that don't track stock. */
    fileHasStock: input.rows.some((r) => Number(text(r.stock).replace(/,/g, '')) > 0),
  };
  if (input.dryRun || plan.length === 0) return { dryRun: true, summary, rows: results };

  await db.transaction(async (tx) => {
    let sort = allCategories.length;
    for (const name of newCategories) {
      const slug = `${slugify(name) || 'aisle'}-${Date.now().toString(36)}${sort}`;
      const nameEn = name === DEFAULT_CATEGORY.name ? DEFAULT_CATEGORY.nameEn : null;
      const [c] = await tx.insert(categories).values({ name, nameEn, slug, emoji: '🛒', sortOrder: sort++ }).returning({ id: categories.id });
      catLookup.set(catKey(name), c.id);
    }
    const now = new Date();
    for (const p of plan) {
      const categoryId = p.category ? catLookup.get(catKey(p.category)) : undefined;
      if (p.existing) {
        await tx
          .update(products)
          .set({ ...p.values, ...(categoryId ? { categoryId } : {}), updatedAt: now })
          .where(eq(products.id, p.existing.id));
        if (p.stock != null && p.stock !== p.existing.stock) {
          const [locked] = await tx.select({ stock: products.stock }).from(products).where(eq(products.id, p.existing.id)).for('update');
          const delta = p.stock - locked.stock;
          if (delta !== 0) {
            await tx.update(products).set({ stock: p.stock }).where(eq(products.id, p.existing.id));
            await tx.insert(inventoryMovements).values({
              productId: p.existing.id,
              delta,
              stockAfter: p.stock,
              reason: delta > 0 ? 'restock' : 'adjustment',
              actorUserId,
              note: `Import (row ${p.row})`,
            });
          }
        }
      } else {
        const stock = p.stock ?? 0;
        // No emoji in the file → use the aisle's emoji (🧃 for drinks…) until a photo is added.
        const emoji = (p.values.emoji as string | undefined) ?? catEmoji.get(categoryId!) ?? '🛒';
        const [created] = await tx
          .insert(products)
          .values({ ...(p.values as { name: string; priceCents: number }), emoji, categoryId: categoryId!, stock })
          .returning({ id: products.id });
        if (stock > 0) {
          await tx.insert(inventoryMovements).values({ productId: created.id, delta: stock, stockAfter: stock, reason: 'initial', actorUserId, note: `Import (row ${p.row})` });
        }
      }
    }
  });
  return { dryRun: false, summary, rows: results };
}

export const productCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(products))[0].n;
