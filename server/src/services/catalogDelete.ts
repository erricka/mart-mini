/**
 * Deleting products and categories (admin only).
 * A deleted product is gone from the shop for good: its stock history goes with it, and coupons that
 * gave it away as a free gift are switched off. Past orders keep their own copy of each line (name,
 * price, photo), so order history and receipts never change.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import { categories, coupons, media, orderItems, products } from '../db/schema.js';
import { MEDIA_ID } from './media.js';

export interface DeleteResult {
  deleted: number;
  /** Coupons switched off because their free gift was deleted. */
  couponsDisabled: number;
}

const mediaIdOf = (url: string | null) => {
  const id = url?.startsWith('/media/') ? url.slice('/media/'.length) : null;
  return id && MEDIA_ID.test(id) ? id : null;
};

async function deleteProductsTx(tx: Tx, ids: number[]): Promise<DeleteResult> {
  if (!ids.length) return { deleted: 0, couponsDisabled: 0 };
  const off = await tx
    .update(coupons)
    .set({ active: false })
    .where(and(inArray(coupons.freeProductId, ids), eq(coupons.active, true)))
    .returning({ id: coupons.id });
  const gone = await tx.delete(products).where(inArray(products.id, ids)).returning({ id: products.id, imageUrl: products.imageUrl });

  // Uploaded photos nobody uses any more (no other product, no past order) are removed too.
  const photoUrls = [...new Set(gone.map((p) => p.imageUrl).filter((u): u is string => !!mediaIdOf(u)))];
  if (photoUrls.length) {
    const stillUsed = new Set([
      ...(await tx.select({ u: products.imageUrl }).from(products).where(inArray(products.imageUrl, photoUrls))).map((r) => r.u),
      ...(await tx.select({ u: orderItems.imageUrl }).from(orderItems).where(inArray(orderItems.imageUrl, photoUrls))).map((r) => r.u),
    ]);
    const unused = photoUrls.filter((u) => !stillUsed.has(u)).map((u) => mediaIdOf(u)!);
    if (unused.length) await tx.delete(media).where(inArray(media.id, unused));
  }
  return { deleted: gone.length, couponsDisabled: off.length };
}

export const deleteProducts = (ids: number[]) => db.transaction((tx) => deleteProductsTx(tx, [...new Set(ids)]));

/** Deletes a category. Its products are deleted with it (the caller asks the admin first). */
export async function deleteCategory(id: number): Promise<(DeleteResult & { category: string }) | null> {
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(categories).where(eq(categories.id, id)).for('update');
    if (!cat) return null;
    const ids = (await tx.select({ id: products.id }).from(products).where(eq(products.categoryId, id))).map((r) => r.id);
    const result = await deleteProductsTx(tx, ids);
    await tx.delete(categories).where(eq(categories.id, id));
    return { ...result, category: cat.name };
  });
}

export const productCountIn = async (categoryId: number) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.categoryId, categoryId)))[0].n;

export { deleteProductsTx };
