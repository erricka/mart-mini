/**
 * One-off clean-ups the shop owner asked for, run once each at start-up on the live shop.
 * Each task is recorded in `maintenance_runs` (with what it did), so it never runs twice — even when
 * two server instances start at the same time. A failing task changes nothing and retries next start.
 */
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db, type Tx } from '../db/client.js';
import { branches, categories, maintenanceRuns, products } from '../db/schema.js';
import { deleteProductsTx } from './catalogDelete.js';
import { DEFAULT_EMOJI, guessCategoryEmoji } from './categoryEmoji.js';
import { plausibleBranchPin } from './branches.js';

interface Task {
  name: string;
  run: (tx: Tx) => Promise<Record<string, unknown>>;
}

/**
 * 5 Nov 2026: remove the 254 products uploaded that day (the POS import confirmed at 03:29 UTC — all its
 * rows share the import's transaction time) — only if that batch is exactly 254, as the owner said —
 * and every food category of the starter set with its products.
 */
const cleanup20261105: Task = {
  name: 'cleanup-2026-11-05',
  run: async (tx) => {
    const from = new Date('2026-11-05T03:29:10Z');
    const to = new Date('2026-11-05T03:31:00Z');
    const expected = 254;
    const batch = await tx.select({ id: products.id }).from(products).where(and(gte(products.createdAt, from), lt(products.createdAt, to)));
    const batchResult =
      batch.length === expected ? { removed: (await deleteProductsTx(tx, batch.map((b) => b.id))).deleted } : { skipped: true, found: batch.length, expected };

    const food = await tx
      .select()
      .from(categories)
      .where(inArray(categories.slug, ['fresh-produce', 'dairy-eggs', 'bakery', 'meat-seafood', 'drinks', 'snacks', 'pantry']));
    let foodProducts = 0;
    for (const c of food) {
      const ids = (await tx.select({ id: products.id }).from(products).where(eq(products.categoryId, c.id))).map((r) => r.id);
      foodProducts += (await deleteProductsTx(tx, ids)).deleted;
      await tx.delete(categories).where(eq(categories.id, c.id));
    }
    return { batch: batchResult, foodCategories: food.map((c) => c.nameEn ?? c.name), foodProducts };
  },
};

/** 6 Nov 2026: categories still showing the default 🛒 get an emoji that fits (and so do their products). */
const categoryEmojis20261106: Task = {
  name: 'category-emojis-2026-11-06',
  run: async (tx) => {
    const changed: Record<string, string> = {};
    let productsUpdated = 0;
    for (const c of await tx.select().from(categories).where(eq(categories.emoji, DEFAULT_EMOJI))) {
      const emoji = guessCategoryEmoji(c.name, c.nameEn);
      if (!emoji) continue;
      await tx.update(categories).set({ emoji }).where(eq(categories.id, c.id));
      const p = await tx
        .update(products)
        .set({ emoji })
        .where(and(eq(products.categoryId, c.id), eq(products.emoji, DEFAULT_EMOJI)))
        .returning({ id: products.id });
      productsUpdated += p.length;
      changed[c.name] = emoji;
    }
    return { changed, productsUpdated };
  },
};

/** 6 Nov 2026: the owner's second mart, from its Google Maps link (the pin is read from the link at start-up). */
const secondBranch20261106: Task = {
  name: 'second-branch-2026-11-06',
  run: async (tx) => {
    const url = 'https://maps.app.goo.gl/z3yTnwv4H9q4L4fj8';
    const existing = await tx.select().from(branches).orderBy(asc(branches.sortOrder), asc(branches.id));
    if (existing.some((b) => b.mapsUrl?.includes('z3yTnwv4H9q4L4fj8'))) return { added: false };
    const first = existing[0];
    const [b] = await tx
      .insert(branches)
      .values({
        name: 'mart25 — សាខា ២',
        nameEn: 'mart25 — Branch 2',
        hours: first?.hours ?? '',
        mapsUrl: url,
        sortOrder: (existing.at(-1)?.sortOrder ?? 0) + 1,
      })
      .returning();
    return { added: true, id: b.id };
  },
};

/**
 * 6 Nov 2026: branch 2's share link (iPhone "Share") carries no coordinates; the pin read from it
 * landed in the USA. Clear any branch pin far from the first branch so the owner sets it on the map.
 */
const fixFarBranchPins20261106: Task = {
  name: 'fix-far-branch-pins-2026-11-06',
  run: async (tx) => {
    const all = await tx.select().from(branches).orderBy(asc(branches.sortOrder), asc(branches.id));
    const first = all.find((b) => b.lat != null && b.lng != null);
    const cleared: string[] = [];
    if (first) {
      for (const b of all) {
        if (b.id === first.id || b.lat == null || b.lng == null) continue;
        if (!plausibleBranchPin({ lat: b.lat, lng: b.lng }, [{ lat: first.lat!, lng: first.lng! }])) {
          // Drop the pin and the link (re-reading the link would give the same wrong place).
          await tx.update(branches).set({ lat: null, lng: null, mapsUrl: null }).where(eq(branches.id, b.id));
          cleared.push(b.name);
        }
      }
    }
    return { cleared };
  },
};

export const TASKS: Task[] = [cleanup20261105, categoryEmojis20261106, secondBranch20261106, fixFarBranchPins20261106];

export async function runMaintenance(log: FastifyBaseLogger, opts: { force?: boolean; only?: string } = {}) {
  if (config.NODE_ENV !== 'production' && !opts.force) return null;
  const results: Record<string, unknown> = {};
  for (const task of TASKS) {
    if (opts.only && task.name !== opts.only) continue;
    const result = await db.transaction(async (tx) => {
      const claimed = await tx.insert(maintenanceRuns).values({ name: task.name }).onConflictDoNothing().returning();
      if (!claimed.length) return null; // already done
      const r = await task.run(tx);
      await tx.update(maintenanceRuns).set({ result: r }).where(eq(maintenanceRuns.name, task.name));
      return r;
    });
    if (result) {
      results[task.name] = result;
      log.info({ maintenance: task.name, result }, `One-off task ${task.name} done: ${JSON.stringify(result)}`);
    }
  }
  return Object.keys(results).length ? results : null;
}
