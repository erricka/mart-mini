import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { categories, inventoryMovements, products } from '../../db/schema.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../../lib/errors.js';
import { tr } from '../../lib/i18n.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { importProducts, importSchema } from '../../services/productImport.js';
import { isPhotoUrl, saveMedia } from '../../services/media.js';
import { deleteCategory, deleteProducts, productCountIn } from '../../services/catalogDelete.js';
import { DEFAULT_EMOJI, guessCategoryEmoji } from '../../services/categoryEmoji.js';

/** When a product was added, by day in the shop's time zone (Cambodia). */
const SHOP_TZ = 'Asia/Phnom_Penh';
const addedDaysAgo = sql`((now() at time zone ${SHOP_TZ})::date - (${products.createdAt} at time zone ${SHOP_TZ})::date)`;
const ADDED: Record<'today' | 'yesterday' | 'week', SQL> = {
  today: sql`${addedDaysAgo} = 0`,
  yesterday: sql`${addedDaysAgo} = 1`,
  week: sql`${addedDaysAgo} between 0 and 6`,
};

const productInput = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1, 'err.product_name').max(120),
  nameEn: z.string().trim().max(120).nullable().optional(),
  sku: z.string().trim().max(64).nullable().optional(),
  description: z.string().trim().max(2000).default(''),
  descriptionEn: z.string().trim().max(2000).nullable().optional(),
  unit: z.string().trim().max(40).default(''),
  priceCents: z.number().int().min(0).max(10_000_000),
  compareAtCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  emoji: z.string().trim().min(1).max(16).default('🛒'),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || isPhotoUrl(v), 'err.image_url')
    .nullable()
    .optional(),
  tags: z.string().trim().max(300).default(''),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
});

const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().max(60).nullable().optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,60}$/, 'err.slug')
    .optional(),
  emoji: z.string().trim().min(1).max(16).default('🛒'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'err.colour').default('#22c55e'),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || `cat-${Date.now()}`;

const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(8, 12).toString('ascii') === 'WEBP' },
};

export async function adminCatalogRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);
  app.addHook('preHandler', guard.staff);

  // ---------- Products ----------
  app.get('/products', async (req) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(80).optional(),
        categoryId: z.coerce.number().int().positive().optional(),
        stock: z.enum(['all', 'low', 'out']).default('all'),
        /** 'missing' = products without a photo (to photograph them one by one). */
        photo: z.enum(['all', 'missing']).default('all'),
        /** When it was added (e.g. to find and remove a file that was uploaded by mistake). */
        added: z.enum(['all', 'today', 'yesterday', 'week']).default('all'),
        includeInactive: z.coerce.boolean().default(true),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(products.name, like), ilike(products.nameEn, like), ilike(products.sku, like), ilike(products.tags, like))!);
    }
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    if (q.stock === 'low') where.push(sql`${products.stock} between 1 and 5`);
    if (q.stock === 'out') where.push(eq(products.stock, 0));
    if (q.photo === 'missing') where.push(sql`${products.imageUrl} is null`);
    if (q.added !== 'all') where.push(ADDED[q.added]);
    if (!q.includeInactive) where.push(eq(products.active, true));
    const rows = await db
      .select()
      .from(products)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(products.categoryId), asc(products.name));
    const [summary] = await db
      .select({
        total: sql<number>`count(*)::int`,
        out: sql<number>`count(*) filter (where ${products.stock} = 0 and ${products.active})::int`,
        low: sql<number>`count(*) filter (where ${products.stock} between 1 and 5 and ${products.active})::int`,
        noPhoto: sql<number>`count(*) filter (where ${products.imageUrl} is null and ${products.active})::int`,
        addedToday: sql<number>`count(*) filter (where ${ADDED.today})::int`,
      })
      .from(products);
    return { products: rows, summary };
  });

  app.post('/products', async (req, reply) => {
    const body = parse(productInput.extend({ stock: z.number().int().min(0).max(1_000_000).default(0) }), req.body);
    const created = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({ ...body, sku: body.sku || null, nameEn: body.nameEn || null, descriptionEn: body.descriptionEn || null, imageUrl: body.imageUrl || null, compareAtCents: body.compareAtCents ?? null })
        .returning();
      if (body.stock > 0) {
        await tx.insert(inventoryMovements).values({
          productId: p.id,
          delta: body.stock,
          stockAfter: body.stock,
          reason: 'initial',
          actorUserId: req.account!.id,
        });
      }
      return p;
    }).catch((err) => {
      if (isUniqueViolation(err, 'products_sku_uq')) throw badRequest('sku_taken', tr('err.sku_taken'));
      throw err;
    });
    return reply.status(201).send({ product: created });
  });

  app.put('/products/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(productInput, req.body);
    const [p] = await db
      .update(products)
      .set({ ...body, sku: body.sku || null, nameEn: body.nameEn || null, descriptionEn: body.descriptionEn || null, imageUrl: body.imageUrl || null, compareAtCents: body.compareAtCents ?? null, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning()
      .catch((err) => {
        if (isUniqueViolation(err, 'products_sku_uq')) throw badRequest('sku_taken', tr('err.sku_taken'));
        throw err;
      });
    if (!p) throw notFound(tr('err.product_not_found'));
    return { product: p };
  });

  /** Bulk import from Excel/CSV. dryRun=true returns a preview; dryRun=false applies valid rows in one transaction. */
  app.post('/products/import', { bodyLimit: 5_000_000 }, async (req) => {
    const body = parse(importSchema, req.body);
    return importProducts(body, req.account!.id);
  });

  /** Audited stock change. "add" for deliveries/returns (negative = write-off), "set" after a stock count. */
  app.post('/products/:id/stock', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        mode: z.enum(['add', 'set']),
        quantity: z.number().int().min(-1_000_000).max(1_000_000),
        note: z.string().trim().max(300).optional().nullable(),
      }),
      req.body,
    );
    return db.transaction(async (tx) => {
      const [p] = await tx.select().from(products).where(eq(products.id, id)).for('update');
      if (!p) throw notFound(tr('err.product_not_found'));
      const newStock = body.mode === 'set' ? body.quantity : p.stock + body.quantity;
      if (newStock < 0) throw badRequest('negative_stock', tr('err.negative_stock', { n: p.stock }));
      const delta = newStock - p.stock;
      if (delta === 0) return { product: p };
      const [updated] = await tx.update(products).set({ stock: newStock, updatedAt: new Date() }).where(eq(products.id, id)).returning();
      await tx.insert(inventoryMovements).values({
        productId: id,
        delta,
        stockAfter: newStock,
        reason: delta > 0 ? 'restock' : 'adjustment',
        actorUserId: req.account!.id,
        note: body.note || null,
      });
      return { product: updated };
    });
  });

  app.get('/products/:id/movements', async (req) => {
    const { id } = parse(idParam, req.params);
    const rows = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, id))
      .orderBy(desc(inventoryMovements.id))
      .limit(50);
    return { movements: rows };
  });

  // ---------- Categories ----------
  // ---------- Delete (admin only) ----------
  app.delete('/products/:id', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const r = await deleteProducts([id]);
    if (!r.deleted) throw notFound(tr('err.product_not_found'));
    return r;
  });

  app.post('/products/delete', { preHandler: guard.admin }, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(5000) }), req.body);
    return deleteProducts(ids);
  });

  app.delete('/categories/:id', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { withProducts } = parse(z.object({ withProducts: z.enum(['true', 'false']).default('false') }), req.query);
    const n = await productCountIn(id);
    // Never delete products by surprise: the dashboard asks first, then repeats the call with withProducts.
    if (n > 0 && withProducts !== 'true') throw conflict('category_has_products', tr('err.category_has_products', { n }), { products: n });
    const r = await deleteCategory(id);
    if (!r) throw notFound(tr('err.category_not_found'));
    return r;
  });

  app.get('/categories', async () => {
    const rows = await db
      .select({
        category: categories,
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = "categories"."id")`,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return { categories: rows.map((r) => ({ ...r.category, productCount: r.productCount })) };
  });

  app.post('/categories', async (req, reply) => {
    const body = parse(categoryInput, req.body);
    const [c] = await db
      .insert(categories)
      .values({
        ...body,
        // No emoji picked → one that fits the name (🧼 for soap, 🪑 for chairs…).
        emoji: body.emoji === DEFAULT_EMOJI ? (guessCategoryEmoji(body.name, body.nameEn) ?? DEFAULT_EMOJI) : body.emoji,
        nameEn: body.nameEn || null,
        slug: body.slug ?? slugify(body.nameEn || body.name),
      })
      .returning();
    return reply.status(201).send({ category: c });
  });

  app.put('/categories/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(categoryInput, req.body);
    const [c] = await db
      .update(categories)
      .set({ ...body, nameEn: body.nameEn || null, slug: body.slug ?? undefined })
      .where(eq(categories.id, id))
      .returning();
    if (!c) throw notFound(tr('err.category_not_found'));
    return { category: c };
  });

  // ---------- Product photos ----------
  /**
   * Bulk photos: each photo's file name (without extension) is matched to a product's barcode/code,
   * or else to its exact name. dryRun → the matches; otherwise assigns the uploaded photos. Existing
   * photos are kept unless replace = true.
   */
  app.post('/products/photos', { bodyLimit: 1_000_000 }, async (req) => {
    const body = parse(
      z.object({
        dryRun: z.boolean().default(true),
        replace: z.boolean().default(false),
        items: z.array(z.object({ key: z.string().trim().min(1).max(200), url: z.string().trim().max(500).optional() })).max(2000),
      }),
      req.body,
    );
    const all = await db.select({ id: products.id, name: products.name, sku: products.sku, imageUrl: products.imageUrl }).from(products);
    const bySku = new Map(all.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p]));
    const byName = new Map<string, typeof all>();
    for (const p of all) byName.set(p.name.trim().toLowerCase(), [...(byName.get(p.name.trim().toLowerCase()) ?? []), p]);
    const used = new Set<number>();
    const results = body.items.map((it) => {
      const k = it.key.toLowerCase();
      const named = byName.get(k) ?? [];
      const p = bySku.get(k) ?? (named.length === 1 ? named[0] : undefined);
      if (!p) return { key: it.key, status: named.length > 1 ? ('ambiguous' as const) : ('none' as const) };
      if (used.has(p.id)) return { key: it.key, status: 'duplicate' as const, productId: p.id, productName: p.name };
      used.add(p.id);
      const status = p.imageUrl && !body.replace ? ('kept' as const) : ('matched' as const);
      return { key: it.key, status, productId: p.id, productName: p.name, sku: p.sku, url: it.url };
    });
    if (!body.dryRun) {
      await db.transaction(async (tx) => {
        for (const r of results) {
          if (r.status !== 'matched' || !r.url || !isPhotoUrl(r.url)) continue;
          await tx.update(products).set({ imageUrl: r.url, updatedAt: new Date() }).where(eq(products.id, r.productId!));
        }
      });
    }
    return {
      dryRun: body.dryRun,
      matched: results.filter((r) => r.status === 'matched').length,
      results: results.map(({ url: _url, ...r }) => r),
    };
  });

  /** Set one product's photo (quick 📷 from the catalog list). */
  app.put('/products/:id/photo', async (req) => {
    const { id } = parse(idParam, req.params);
    const { imageUrl } = parse(z.object({ imageUrl: z.string().trim().max(500).refine(isPhotoUrl, 'err.image_url').nullable() }), req.body);
    const [p] = await db.update(products).set({ imageUrl, updatedAt: new Date() }).where(eq(products.id, id)).returning();
    if (!p) throw notFound(tr('err.product_not_found'));
    return { product: p };
  });

  // ---------- Image upload (stored in the database → works without a persistent disk) ----------
  app.post('/uploads', async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('no_file', tr('err.no_file'));
    const type = IMAGE_TYPES[file.mimetype];
    if (!type) throw badRequest('bad_type', tr('err.bad_image_type'));
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('too_large', tr('err.image_too_large', { n: config.MAX_UPLOAD_MB }));
    if (!type.magic(buf)) throw badRequest('bad_type', tr('err.bad_image'));
    return { url: await saveMedia(buf, type.ext) };
  });
}
