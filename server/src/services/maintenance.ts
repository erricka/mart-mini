/**
 * One-off clean-ups the shop owner asked for, run once at start-up on the live shop.
 * Each task is recorded in `maintenance_runs` (with what it did), so it never runs twice — even when
 * two server instances start at the same time.
 */
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { categories, maintenanceRuns, products } from '../db/schema.js';
import { deleteProductsTx } from './catalogDelete.js';

/**
 * 5 Nov 2026: the owner asked to remove
 *  - the 254 products uploaded that day (the POS import confirmed at 03:29 UTC — all its rows share the
 *    import's transaction time). Only removed if that batch is exactly 254 products, as the owner said;
 *    otherwise it is left alone and the owner removes it from Catalog → "Added: today/yesterday".
 *  - every food category of the starter set, with the products in them.
 */
const CLEANUP_2026_11_05 = {
  name: 'cleanup-2026-11-05',
  batch: { from: new Date('2026-11-05T03:29:10Z'), to: new Date('2026-11-05T03:31:00Z'), expected: 254 },
  foodCategorySlugs: ['fresh-produce', 'dairy-eggs', 'bakery', 'meat-seafood', 'drinks', 'snacks', 'pantry'],
};

export async function runMaintenance(log: FastifyBaseLogger, opts: { force?: boolean } = {}) {
  if (config.NODE_ENV !== 'production' && !opts.force) return null;
  const task = CLEANUP_2026_11_05;
  return db.transaction(async (tx) => {
    const claimed = await tx.insert(maintenanceRuns).values({ name: task.name }).onConflictDoNothing().returning();
    if (!claimed.length) return null; // already done

    const batch = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(gte(products.createdAt, task.batch.from), lt(products.createdAt, task.batch.to)));
    const batchResult =
      batch.length === task.batch.expected
        ? { removed: (await deleteProductsTx(tx, batch.map((b) => b.id))).deleted }
        : { skipped: true, found: batch.length, expected: task.batch.expected };

    const food = await tx.select().from(categories).where(inArray(categories.slug, task.foodCategorySlugs));
    let foodProducts = 0;
    for (const c of food) {
      const ids = (await tx.select({ id: products.id }).from(products).where(eq(products.categoryId, c.id))).map((r) => r.id);
      foodProducts += (await deleteProductsTx(tx, ids)).deleted;
      await tx.delete(categories).where(eq(categories.id, c.id));
    }

    const result = { batch: batchResult, foodCategories: food.map((c) => c.nameEn ?? c.name), foodProducts };
    await tx.update(maintenanceRuns).set({ result }).where(eq(maintenanceRuns.name, task.name));
    log.info({ maintenance: task.name, result }, `One-off clean-up done: ${JSON.stringify(result)}`);
    return result;
  });
}
