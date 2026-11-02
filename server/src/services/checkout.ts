import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../config.js';
import { db, type Executor } from '../db/client.js';
import {
  addresses,
  couponRedemptions,
  coupons,
  customerRewards,
  inventoryMovements,
  orderEvents,
  orderItems,
  orders,
  payments,
  products,
  users,
  type Coupon,
  type CustomerReward,
  type Product,
  type User,
} from '../db/schema.js';
import { badRequest, conflict, isUniqueViolation } from '../lib/errors.js';
import { formatMoney, orderCode } from '../lib/format.js';
import { normalizePhone } from '../lib/phone.js';
import { lockUser } from './loyalty.js';
import { kickNotifications, queueNotification } from './notifications.js';
import { notifyStaffNewOrder } from './orders.js';
import { createQrPaymentRecord, qrModeUsable } from './payments.js';
import { calculateQuote, type Quote } from './pricing.js';
import { getLevels, getSettings, levelFor } from './settings.js';

export const cartSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) }))
    .max(100),
  fulfillmentType: z.enum(['delivery', 'pickup']),
  couponCode: z.string().trim().max(40).optional().nullable(),
  customerRewardId: z.number().int().positive().optional().nullable(),
});

export const addressInputSchema = z.object({
  label: z.string().trim().max(30).optional().default('Home'),
  line1: z.string().trim().min(3, 'Please enter your street address.').max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2, 'Please enter your city.').max(100),
  postalCode: z.string().trim().max(20).optional().nullable(),
  instructions: z.string().trim().max(300).optional().nullable(),
});

export const placeOrderSchema = cartSchema.extend({
  idempotencyKey: z.string().min(8).max(100),
  paymentMethod: z.enum(['cash', 'qr']),
  contactName: z.string().trim().min(1, 'Please enter a contact name.').max(80),
  contactPhone: z.string().trim().min(5, 'Please enter a phone number.').max(30),
  addressId: z.number().int().positive().optional().nullable(),
  address: addressInputSchema.extend({ save: z.boolean().optional().default(true) }).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export type CartInput = z.infer<typeof cartSchema>;
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

interface ResolvedDiscount {
  coupon: Coupon | null;
  customerReward: CustomerReward | null;
  error: string | null;
}

async function resolveDiscount(ex: Executor, userId: number, input: CartInput, lock: boolean): Promise<ResolvedDiscount> {
  const none = { coupon: null, customerReward: null };
  if (input.customerRewardId) {
    const q = ex
      .select()
      .from(customerRewards)
      .where(and(eq(customerRewards.id, input.customerRewardId), eq(customerRewards.userId, userId)));
    const [cr] = lock ? await q.for('update') : await q;
    if (!cr) return { ...none, error: 'Reward not found.' };
    if (cr.status === 'used') return { ...none, error: 'This reward has already been used.' };
    if (cr.status !== 'available') return { ...none, error: 'This reward is no longer available.' };
    if (cr.expiresAt && cr.expiresAt < new Date()) return { ...none, error: 'This reward has expired.' };
    const [coupon] = await ex.select().from(coupons).where(eq(coupons.id, cr.couponId));
    return { coupon, customerReward: cr, error: null };
  }
  const code = input.couponCode?.trim().toUpperCase();
  if (code) {
    const q = ex.select().from(coupons).where(sql`upper(${coupons.code}) = ${code}`);
    const [coupon] = lock ? await q.for('update') : await q;
    if (!coupon) return { ...none, error: "We couldn't find that coupon code." };
    if (coupon.maxRedemptions != null && coupon.redeemedCount >= coupon.maxRedemptions) {
      return { ...none, error: 'This coupon has been fully redeemed.' };
    }
    if (coupon.perCustomerLimit != null) {
      const [{ n }] = await ex
        .select({ n: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.couponId, coupon.id),
            eq(couponRedemptions.userId, userId),
            eq(couponRedemptions.status, 'active'),
          ),
        );
      if (n >= coupon.perCustomerLimit) return { ...none, error: "You've already used this coupon." };
    }
    return { coupon, customerReward: null, error: null };
  }
  return { ...none, error: null };
}

function buildQuote(
  input: CartInput,
  productsById: Map<number, Product>,
  settings: Awaited<ReturnType<typeof getSettings>>,
  discount: ResolvedDiscount,
  multiplierPercent: number,
): Quote {
  const lines = input.items
    .filter((i) => productsById.has(i.productId))
    .map((i) => ({ product: productsById.get(i.productId)!, quantity: i.quantity }));
  const giftId = discount.coupon?.discountType === 'free_product' ? discount.coupon.freeProductId : null;
  return calculateQuote({
    lines,
    fulfillment: input.fulfillmentType,
    settings,
    coupon: discount.coupon,
    couponFromWallet: discount.customerReward != null,
    giftProduct: giftId ? (productsById.get(giftId) ?? null) : null,
    multiplierPercent,
    now: new Date(),
  });
}

/** Read-only price check used by the cart/checkout screens. */
export async function quoteCart(user: User, input: CartInput) {
  const [settings, allLevels] = await Promise.all([getSettings(), getLevels()]);
  const discount = await resolveDiscount(db, user.id, input, false);
  const ids = new Set(input.items.map((i) => i.productId));
  if (discount.coupon?.discountType === 'free_product' && discount.coupon.freeProductId) ids.add(discount.coupon.freeProductId);
  const rows = ids.size ? await db.select().from(products).where(inArray(products.id, [...ids])) : [];
  const byId = new Map(rows.map((p) => [p.id, p]));
  const level = levelFor(allLevels, user.pointsBalance).current;
  const quote = buildQuote(input, byId, settings, discount, level.multiplierPercent);
  const missing = input.items.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
  if (missing.length) quote.issues.push('Some items in your cart are no longer sold. Please remove them.');
  return {
    ...quote,
    canPlace: quote.issues.length === 0 && missing.length === 0,
    missingProductIds: missing,
    couponError: discount.error ?? quote.couponError,
    currency: settings.currency,
    level: { name: level.name, emoji: level.emoji, multiplierPercent: level.multiplierPercent },
  };
}

async function findOrderByKey(userId: number, key: string) {
  const [o] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)));
  return o ?? null;
}

/**
 * Creates an order atomically. Safe against:
 *  - double taps / retries: idempotency key + unique index, replay returns the original order
 *  - simultaneous purchases: product rows locked in id order, conditional stock decrement, CHECK(stock >= 0)
 *  - reward/coupon double use: conditional status update + atomic redemption counter
 */
export async function placeOrder(user: User, input: PlaceOrderInput): Promise<{ orderId: number; replayed: boolean }> {
  if (input.items.length === 0) throw badRequest('empty_cart', 'Your cart is empty.');
  const phone = normalizePhone(input.contactPhone);
  if (!phone) throw badRequest('invalid_phone', 'Please enter a valid phone number (7–15 digits).');

  const prior = await findOrderByKey(user.id, input.idempotencyKey);
  if (prior) return { orderId: prior.id, replayed: true };

  try {
    const result = await db.transaction(async (tx) => {
      // 1) Serialize this customer's checkouts, then re-check the idempotency key under the lock.
      const u = await lockUser(tx, user.id);
      const [dup] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.userId, u.id), eq(orders.idempotencyKey, input.idempotencyKey)));
      if (dup) return { orderId: dup.id, replayed: true };

      const [settings, allLevels] = await Promise.all([getSettings(tx), getLevels(tx)]);
      if (input.paymentMethod === 'qr' && !qrModeUsable(settings)) throw badRequest('payment_unavailable', 'QR payment is not available right now. Please choose cash.');
      if (input.paymentMethod === 'cash' && !settings.cashEnabled) throw badRequest('payment_unavailable', 'Cash payment is not available. Please pay by QR.');
      const byQr = input.paymentMethod === 'qr';

      // 2) Delivery address (only for delivery).
      let address: { line1: string; line2: string | null; city: string; postalCode: string | null; instructions: string | null } | null =
        null;
      if (input.fulfillmentType === 'delivery') {
        if (input.addressId) {
          const [a] = await tx
            .select()
            .from(addresses)
            .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, u.id)));
          if (!a) throw badRequest('address_not_found', 'Please choose a delivery address.');
          address = a;
        } else if (input.address) {
          const a = input.address;
          address = { line1: a.line1, line2: a.line2 ?? null, city: a.city, postalCode: a.postalCode ?? null, instructions: a.instructions ?? null };
          if (a.save) {
            const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(addresses).where(eq(addresses.userId, u.id));
            if (n < 10) await tx.insert(addresses).values({ userId: u.id, label: a.label || 'Home', ...address, isDefault: n === 0 });
          }
        } else {
          throw badRequest('address_required', 'Please add a delivery address.');
        }
      }

      // 3) Coupon / reward (locked before products — consistent lock order with cancellation).
      const discount = await resolveDiscount(tx, u.id, input, true);
      if (discount.error) throw conflict('coupon_invalid', discount.error);

      // 4) Lock every product row involved, in id order, then price from fresh data.
      const ids = new Set(input.items.map((i) => i.productId));
      if (discount.coupon?.discountType === 'free_product' && discount.coupon.freeProductId) ids.add(discount.coupon.freeProductId);
      const locked = await tx
        .select()
        .from(products)
        .where(inArray(products.id, [...ids]))
        .orderBy(asc(products.id))
        .for('update');
      const byId = new Map(locked.map((p) => [p.id, p]));
      const missing = input.items.filter((i) => !byId.has(i.productId));
      if (missing.length) throw conflict('product_unavailable', 'Some items in your cart are no longer sold.', { missing });

      const level = levelFor(allLevels, u.pointsBalance).current;
      const quote = buildQuote(input, byId, settings, discount, level.multiplierPercent);
      if (!quote.canPlace) {
        throw conflict('cannot_place', quote.issues[0], { issues: quote.issues, lines: quote.lines.filter((l) => l.issue) });
      }
      if (discount.coupon && quote.couponError) throw conflict('coupon_invalid', quote.couponError);

      // 5) Create the order and its lines.
      const now = new Date();
      const [order] = await tx
        .insert(orders)
        .values({
          userId: u.id,
          idempotencyKey: input.idempotencyKey,
          fulfillmentType: input.fulfillmentType,
          // QR orders wait for payment before the shop sees them; stock is reserved meanwhile.
          status: byQr ? 'awaiting_payment' : 'placed',
          paymentMethod: input.paymentMethod,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          deliveryFeeCents: quote.baseDeliveryFeeCents,
          totalCents: quote.totalCents,
          couponId: quote.discount ? discount.coupon!.id : null,
          customerRewardId: quote.discount ? (discount.customerReward?.id ?? null) : null,
          discountLabel: quote.discount?.label ?? null,
          contactName: input.contactName,
          contactPhone: phone.display,
          addressLine1: address?.line1 ?? null,
          addressLine2: address?.line2 ?? null,
          city: address?.city ?? null,
          postalCode: address?.postalCode ?? null,
          addressInstructions: address?.instructions ?? null,
          customerNote: input.note || null,
          pointsEstimate: quote.pointsEstimate,
        })
        .returning();

      await tx.insert(orderItems).values(
        quote.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          name: l.name,
          unit: l.unit,
          emoji: l.emoji,
          imageUrl: l.imageUrl,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.lineTotalCents,
          isGift: l.isGift,
        })),
      );

      // 6) Decrement stock (conditional update is a second guard on top of the row locks).
      const qty = new Map<number, { qty: number; gift: boolean }>();
      for (const l of quote.lines) {
        const prev = qty.get(l.productId);
        qty.set(l.productId, { qty: (prev?.qty ?? 0) + l.quantity, gift: (prev?.gift ?? false) || l.isGift });
      }
      for (const [productId, { qty: q, gift }] of [...qty.entries()].sort((a, b) => a[0] - b[0])) {
        const upd = await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${q}`, updatedAt: now })
          .where(and(eq(products.id, productId), gte(products.stock, q)))
          .returning({ stock: products.stock });
        if (!upd.length) throw conflict('out_of_stock', `${byId.get(productId)?.name ?? 'An item'} just sold out.`);
        await tx.insert(inventoryMovements).values({
          productId,
          delta: -q,
          stockAfter: upd[0].stock,
          reason: gift ? 'gift' : 'order',
          orderId: order.id,
          actorUserId: u.id,
        });
      }

      // 7) Redeem coupon / reward.
      if (quote.discount && discount.coupon) {
        const c = discount.coupon;
        const counter = await tx
          .update(coupons)
          .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
          .where(
            c.maxRedemptions != null ? and(eq(coupons.id, c.id), lt(coupons.redeemedCount, c.maxRedemptions)) : eq(coupons.id, c.id),
          )
          .returning({ id: coupons.id });
        if (!counter.length) throw conflict('coupon_invalid', 'This coupon has been fully redeemed.');
        await tx.insert(couponRedemptions).values({
          couponId: c.id,
          userId: u.id,
          orderId: order.id,
          customerRewardId: discount.customerReward?.id ?? null,
          discountCents: quote.discountCents,
        });
        if (discount.customerReward) {
          const used = await tx
            .update(customerRewards)
            .set({ status: 'used', usedAt: now, orderId: order.id })
            .where(and(eq(customerRewards.id, discount.customerReward.id), eq(customerRewards.status, 'available')))
            .returning({ id: customerRewards.id });
          if (!used.length) throw conflict('coupon_invalid', 'This reward has already been used.');
        }
      }

      // 8) Payment record (kept separate from fulfilment status).
      if (byQr) {
        await createQrPaymentRecord(tx, order, settings);
      } else {
        await tx.insert(payments).values({ orderId: order.id, provider: 'cash', amountCents: quote.totalCents, status: 'unpaid' });
      }
      await tx.insert(orderEvents).values({
        orderId: order.id,
        kind: 'status',
        status: byQr ? 'awaiting_payment' : 'placed',
        actorUserId: u.id,
        actorRole: 'customer',
      });

      // Remember the phone for next time if the profile doesn't have one yet.
      if (!u.phone) await tx.update(users).set({ phone: phone.display, phoneVerified: false }).where(eq(users.id, u.id));

      // 9) Notifications (outbox). Cash orders reach the shop now; QR orders once paid.
      const total = formatMoney(quote.totalCents, settings.currency);
      const how = input.fulfillmentType === 'delivery' ? 'delivery' : 'pickup';
      if (byQr) {
        await queueNotification(tx, {
          userId: u.id,
          chatId: u.telegramId,
          kind: 'payment_pending',
          text: `🧾 Order <b>${orderCode(order.id)}</b> (${total}) is reserved for ${settings.paymentWindowMinutes} minutes.\nComplete your QR payment to send it to the shop.`,
          orderId: order.id,
          buttonText: '📱 Pay now',
          buttonPath: `/orders/${order.id}/pay`,
        });
      } else {
        await queueNotification(tx, {
          userId: u.id,
          chatId: u.telegramId,
          kind: 'order_placed',
          text: `🧾 Thanks! We received order <b>${orderCode(order.id)}</b> (${total}, ${how}, cash).\nWe'll message you when it's confirmed.${quote.pointsEstimate ? `\n⭐ You'll earn ${quote.pointsEstimate} points when it's completed.` : ''}`,
          orderId: order.id,
          buttonText: '📍 Track order',
          buttonPath: `/orders/${order.id}`,
        });
        await notifyStaffNewOrder(tx, order.id);
      }

      return { orderId: order.id, replayed: false };
    });
    kickNotifications();
    return result;
  } catch (err) {
    // Two identical submissions raced past the first check: return the order that won.
    if (isUniqueViolation(err, 'orders_user_idempotency_uq')) {
      const existing = await findOrderByKey(user.id, input.idempotencyKey);
      if (existing) return { orderId: existing.id, replayed: true };
    }
    throw err;
  }
}
