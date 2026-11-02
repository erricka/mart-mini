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

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();

export const importSchema = z.object({
  dryRun: z.boolean().default(true),
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
  error?: string;
}

export async function importProducts(input: z.infer<typeof importSchema>, actorUserId: number) {
  if (input.rows.length > 2000) throw badRequest('too_many_rows', tr('imp.too_many'));

  const [allProducts, allCategories] = await Promise.all([db.select().from(products), db.select().from(categories)]);
  const bySku = new Map(allProducts.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
  const byName = new Map(allProducts.map((p) => [p.name.trim().toLowerCase(), p]));
  const catKey = (s: string) => s.trim().toLowerCase();
  const catLookup = new Map<string, number>();
  const catEmoji = new Map(allCategories.map((c) => [c.id, c.emoji]));
  for (const c of allCategories) {
    catLookup.set(catKey(c.name), c.id);
    if (c.nameEn) catLookup.set(catKey(c.nameEn), c.id);
    catLookup.set(catKey(c.slug), c.id);
  }

  const seen = new Map<string, number>();
  const newCategories = new Set<string>();
  const results: ImportRowResult[] = [];
  const plan: { row: number; existing: Product | null; category: string; values: Record<string, unknown>; stock: number | null }[] = [];

  for (const r of input.rows) {
    const name = text(r.name);
    const category = text(r.category);
    const sku = text(r.sku);
    const priceCents = parseMoney(r.price);
    const stockText = text(r.stock);
    const stock = stockText === '' ? null : Number(stockText.replace(/,/g, ''));
    const base = { row: r.row, name, category, priceCents, stock: stock != null && Number.isInteger(stock) ? stock : null };
    const fail = (error: string) => results.push({ ...base, action: 'error', error });

    if (!name) {
      fail(tr('imp.name_required'));
      continue;
    }
    const existing = (sku && bySku.get(sku.toLowerCase())) || byName.get(name.toLowerCase()) || null;
    if (!category && !existing) {
      fail(tr('imp.category_required'));
      continue;
    }
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
    if (stock != null && (!Number.isInteger(stock) || stock < 0)) {
      fail(tr('imp.stock_invalid'));
      continue;
    }
    const imageUrl = text(r.imageUrl);
    if (imageUrl && !/^https:\/\//.test(imageUrl)) {
      fail(tr('imp.image_invalid'));
      continue;
    }
    const key = sku ? `sku:${sku.toLowerCase()}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) {
      fail(tr('imp.duplicate', { row: seen.get(key)! }));
      continue;
    }
    seen.set(key, r.row);
    if (category && !catLookup.has(catKey(category))) newCategories.add(category);

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
    if (imageUrl) values.imageUrl = imageUrl;
    const featured = parseBool(r.featured);
    const active = parseBool(r.active);
    if (featured !== undefined) values.featured = featured;
    if (active !== undefined) values.active = active;

    plan.push({ row: r.row, existing, category, values, stock: base.stock });
    results.push({ ...base, action: existing ? 'update' : 'create' });
  }

  const summary = {
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    error: results.filter((r) => r.action === 'error').length,
    newCategories: [...newCategories],
  };
  if (input.dryRun || plan.length === 0) return { dryRun: true, summary, rows: results };

  await db.transaction(async (tx) => {
    let sort = allCategories.length;
    for (const name of newCategories) {
      const slug = `${slugify(name) || 'aisle'}-${Date.now().toString(36)}${sort}`;
      const [c] = await tx.insert(categories).values({ name, slug, emoji: '🛒', sortOrder: sort++ }).returning({ id: categories.id });
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
