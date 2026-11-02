import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { categories, inventoryMovements, products } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';

const productInput = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1, 'Product name is required.').max(120),
  description: z.string().trim().max(2000).default(''),
  unit: z.string().trim().max(40).default(''),
  priceCents: z.number().int().min(0).max(10_000_000),
  compareAtCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  emoji: z.string().trim().min(1).max(16).default('🛒'),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || v.startsWith('/uploads/') || /^https:\/\//.test(v), 'Image must be an uploaded file or an https:// URL.')
    .nullable()
    .optional(),
  tags: z.string().trim().max(300).default(''),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
});

const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,60}$/, 'Slug may only contain lowercase letters, numbers and dashes.')
    .optional(),
  emoji: z.string().trim().min(1).max(16).default('🛒'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must look like #22c55e').default('#22c55e'),
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
        includeInactive: z.coerce.boolean().default(true),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(products.name, like), ilike(products.tags, like))!);
    }
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    if (q.stock === 'low') where.push(sql`${products.stock} between 1 and 5`);
    if (q.stock === 'out') where.push(eq(products.stock, 0));
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
      })
      .from(products);
    return { products: rows, summary };
  });

  app.post('/products', async (req, reply) => {
    const body = parse(productInput.extend({ stock: z.number().int().min(0).max(1_000_000).default(0) }), req.body);
    const created = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(products)
        .values({ ...body, imageUrl: body.imageUrl || null, compareAtCents: body.compareAtCents ?? null })
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
    });
    return reply.status(201).send({ product: created });
  });

  app.put('/products/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(productInput, req.body);
    const [p] = await db
      .update(products)
      .set({ ...body, imageUrl: body.imageUrl || null, compareAtCents: body.compareAtCents ?? null, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!p) throw notFound('Product not found.');
    return { product: p };
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
      if (!p) throw notFound('Product not found.');
      const newStock = body.mode === 'set' ? body.quantity : p.stock + body.quantity;
      if (newStock < 0) throw badRequest('negative_stock', `Stock can't go below zero (currently ${p.stock}).`);
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
  app.get('/categories', async () => {
    const rows = await db
      .select({
        category: categories,
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = ${categories.id})`,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return { categories: rows.map((r) => ({ ...r.category, productCount: r.productCount })) };
  });

  app.post('/categories', async (req, reply) => {
    const body = parse(categoryInput, req.body);
    const [c] = await db
      .insert(categories)
      .values({ ...body, slug: body.slug ?? slugify(body.name) })
      .returning();
    return reply.status(201).send({ category: c });
  });

  app.put('/categories/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(categoryInput, req.body);
    const [c] = await db
      .update(categories)
      .set({ ...body, slug: body.slug ?? undefined })
      .where(eq(categories.id, id))
      .returning();
    if (!c) throw notFound('Category not found.');
    return { category: c };
  });

  // ---------- Image upload (local disk; swap for S3/R2 in production) ----------
  app.post('/uploads', async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('no_file', 'Please choose an image.');
    const type = IMAGE_TYPES[file.mimetype];
    if (!type) throw badRequest('bad_type', 'Please upload a JPG, PNG or WebP image.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest('too_large', `Images must be under ${config.MAX_UPLOAD_MB} MB.`);
    if (!type.magic(buf)) throw badRequest('bad_type', "That file doesn't look like a valid image.");
    await mkdir(config.uploadDir, { recursive: true });
    const name = `${randomUUID()}.${type.ext}`;
    await writeFile(join(config.uploadDir, name), buf);
    return { url: `/uploads/${name}` };
  });
}
