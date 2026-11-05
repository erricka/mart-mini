/**
 * Admin action "Remove customer". Privacy-first and safe for the shop's records:
 *  - personal data is wiped (name, phone, username, photo, saved addresses, delivery pins/notes on
 *    their past orders), points are zeroed in the ledger, unused rewards are revoked, unsent
 *    Telegram messages are dropped, and their sign-in stops working immediately;
 *  - past orders stay (anonymised) so sales, stock history and insights remain correct;
 *  - the account row is kept as a tombstone, so if the person returns they simply sign up again but
 *    never receive a second welcome gift.
 * Not allowed: removing yourself, staff/admins (change their role first), or a customer with an
 * order still in progress (finish or cancel it first).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { addresses, customerRewards, notifications, orders, staffLoginTokens, users } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { tr } from '../lib/i18n.js';
import { applyPoints } from './loyalty.js';

const ACTIVE = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup'] as const;

export async function removeCustomer(customerId: number, actorUserId: number) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, customerId)).for('update');
    if (!u || u.deletedAt) throw notFound(tr('err.customer_not_found'));
    if (u.id === actorUserId) throw badRequest('remove_self', tr('err.remove_self'));
    if (u.role !== 'customer' || config.ADMIN_TELEGRAM_IDS.includes(u.telegramId)) throw badRequest('remove_staff', tr('err.remove_staff'));
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, u.id), inArray(orders.status, [...ACTIVE])));
    if (n > 0) throw conflict('active_orders', tr('err.remove_active_orders', { n }));

    const now = new Date();
    const removed = tr('ac.removed_name');
    // Points to zero through the ledger (keeps the points history consistent).
    if (u.pointsBalance !== 0) {
      await applyPoints(tx, {
        userId: u.id,
        delta: -u.pointsBalance,
        type: 'manual_adjustment',
        idempotencyKey: `removed:${u.id}:${now.getTime()}`,
        note: 'Customer removed',
        actorUserId,
      });
    }
    await tx.update(customerRewards).set({ status: 'revoked' }).where(and(eq(customerRewards.userId, u.id), eq(customerRewards.status, 'available')));
    await tx.delete(addresses).where(eq(addresses.userId, u.id));
    await tx.delete(staffLoginTokens).where(eq(staffLoginTokens.userId, u.id));
    await tx.delete(notifications).where(and(eq(notifications.userId, u.id), eq(notifications.status, 'pending')));
    // Past orders keep their items and totals, but no longer identify the person.
    await tx
      .update(orders)
      .set({
        contactName: removed,
        contactPhone: '—',
        addressLine1: null,
        addressLine2: null,
        city: null,
        postalCode: null,
        addressInstructions: null,
        deliveryLat: null,
        deliveryLng: null,
        customerNote: null,
      })
      .where(eq(orders.userId, u.id));
    await tx
      .update(users)
      .set({
        firstName: removed,
        lastName: null,
        username: null,
        photoUrl: null,
        phone: null,
        phoneVerified: false,
        pointsBalance: 0,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, u.id));
    return { removed: true };
  });
}
