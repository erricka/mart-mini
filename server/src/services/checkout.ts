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
import { cambodiaDate, type LatLng } from '../lib/geo.js';
import { pick, tr, userLang } from '../lib/i18n.js';
import { normalizePhone } from '../lib/phone.js';
import { lockUser } from './loyalty.js';
import { kickNotifications, queueNotification } from './notifications.js';
import { notifyStaffNewOrder } from './orders.js';
import { calculateQuote, type Quote } from './pricing.js';
import { getLevels, getSettings, levelFor } from './settings.js';

export const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

export const cartSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) }))
    .max(100),
  fulfillmentType: z.enum(['delivery', 'pickup']),
  /** Customer's map pin for delivery (drives the distance-based fee). */
  location: latLngSchema.optional().nullable(),
  /** "same_day" (priced by distance) or "next_day" (I can wait until tomorrow). */
  deliverySpeed: z.enum(['same_day', 'next_day']).optional().default('same_day'),
  /** The customer has entered/chosen a delivery address (flat-fee mode needs one before quoting a fee). */
  addressReady: z.boolean().optional(),
  couponCode: z.string().trim().max(40).optional().nullable(),
  customerRewardId: z.number().int().positive().optional().nullable(),
});

export const addressInputSchema = z.object({
  label: z.string().trim().max(30).optional().default('Home'),
  line1: z.string().trim().min(3, 'err.street_required').max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(2, 'err.city_required').max(100),
  postalCode: z.string().trim().max(20).optional().nullable(),
  instructions: z.string().trim().max(300).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
});

export const placeOrderSchema = cartSchema.extend({
  idempotencyKey: z.string().min(8).max(100),
  // Cash on delivery / at pickup only for now (online payment will plug in here later).
  paymentMethod: z.literal('cash').default('cash'),
  contactName: z.string().trim().min(1, 'err.contact_name').max(80),
  contactPhone: z.string().trim().min(5, 'err.contact_phone').max(30),
  addressId: z.number().int().positive().optional().nullable(),
  address: addressInputSchema.extend({ save: z.boolean().optional().default(true) }).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  /**
   * What the customer saw before tapping "Place order". The server recalculates everything; if its
   * delivery fee or total differs (e.g. the cart or location changed), the order is refused with
   * price_changed instead of charging a different amount.
   */
  expectedDeliveryFeeCents: z.number().int().min(0).nullable().optional(),
  expectedTotalCents: z.number().int().min(0).optional(),
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
    if (!cr) return { ...none, error: tr('err.reward_not_found') };
    if (cr.status === 'used') return { ...none, error: tr('err.reward_used') };
    if (cr.status !== 'available') return { ...none, error: tr('err.reward_unavailable') };
    if (cr.expiresAt && cr.expiresAt < new Date()) return { ...none, error: tr('err.reward_expired') };
    const [coupon] = await ex.select().from(coupons).where(eq(coupons.id, cr.couponId));
    return { coupon, customerReward: cr, error: null };
  }
  const code = input.couponCode?.trim().toUpperCase();
  if (code) {
    const q = ex.select().from(coupons).where(sql`upper(${coupons.code}) = ${code}`);
    const [coupon] = lock ? await q.for('update') : await q;
    if (!coupon) return { ...none, error: tr('err.coupon_not_found') };
    if (coupon.maxRedemptions != null && coupon.redeemedCount >= coupon.maxRedemptions) {
      return { ...none, error: tr('err.coupon_exhausted') };
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
      if (n >= coupon.perCustomerLimit) return { ...none, error: tr('err.coupon_used_by_you') };
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
  delivery: { destination: LatLng | null; addressReady: boolean; requireLocation: boolean },
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
    destination: delivery.destination,
    addressReady: delivery.addressReady,
    deliverySpeed: input.deliverySpeed,
    requireLocation: delivery.requireLocation,
  });
}

/** Read-only price check used by the cart/checkout screens. */
export async function quoteCart(user: User, input: CartInput) {
  const [settings, allLevels] = await Promise.all([getSettings(), getLevels()]);
  const discount = await resolveDiscount(db, user.id, input, false);
  const ids = new Set(input.items.map((i) => i.productId));
  if (discount.coupon?.discountType === 'free_product' && discount.coupon.freeProductId) ids.add(discount.coupon.freeProductId);
  const rows = ids.size ? await db.select().from(products).where(inArray(products.id, [...ids])) : [];
  // Display names in the customer's language.
  const byId = new Map(rows.map((p) => [p.id, { ...p, name: pick(p.name, p.nameEn) }]));
  if (discount.coupon) discount.coupon = { ...discount.coupon, title: pick(discount.coupon.title, discount.coupon.titleEn) };
  const level = levelFor(allLevels, user.pointsBalance).current;
  const quote = buildQuote(input, byId, settings, discount, level.multiplierPercent, {
    destination: input.location ?? null,
    addressReady: input.addressReady ?? false,
    requireLocation: false,
  });
  const missing = input.items.filter((i) => !byId.has(i.productId)).map((i) => i.productId);
  if (missing.length) quote.issues.push(tr('err.items_gone'));
  return {
    ...quote,
    canPlace: quote.issues.length === 0 && missing.length === 0,
    missingProductIds: missing,
    couponError: discount.error ?? quote.couponError,
    currency: settings.currency,
    level: { name: level.name, emoji: level.emoji, multiplierPercent: level.multiplierPercent },
    nextDayDate: cambodiaDate(new Date(), 1),
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
  if (input.items.length === 0) throw badRequest('empty_cart', tr('err.empty_cart'));
  const phone = normalizePhone(input.contactPhone);
  if (!phone) throw badRequest('invalid_phone', tr('err.invalid_phone'));

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

      // 2) Delivery address and map pin (only for delivery). The pin sent with the order wins;
      //    otherwise the saved address's pin is used.
      let address: { line1: string; line2: string | null; city: string; postalCode: string | null; instructions: string | null } | null =
        null;
      let destination: LatLng | null = input.location ?? null;
      if (input.fulfillmentType === 'delivery') {
        if (input.addressId) {
          const [a] = await tx
            .select()
            .from(addresses)
            .where(and(eq(addresses.id, input.addressId), eq(addresses.userId, u.id)));
          if (!a) throw badRequest('address_not_found', tr('err.address_not_found'));
          address = a;
          if (!destination && a.lat != null && a.lng != null) destination = { lat: a.lat, lng: a.lng };
          // Remember a newly dropped / moved pin on the saved address for next time.
          if (input.location && (a.lat !== input.location.lat || a.lng !== input.location.lng)) {
            await tx.update(addresses).set({ lat: input.location.lat, lng: input.location.lng }).where(eq(addresses.id, a.id));
          }
        } else if (input.address) {
          const a = input.address;
          address = { line1: a.line1, line2: a.line2 ?? null, city: a.city, postalCode: a.postalCode ?? null, instructions: a.instructions ?? null };
          if (!destination && a.lat != null && a.lng != null) destination = { lat: a.lat, lng: a.lng };
          if (a.save) {
            const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(addresses).where(eq(addresses.userId, u.id));
            if (n < 10) {
              await tx
                .insert(addresses)
                .values({ userId: u.id, label: a.label || 'Home', ...address, lat: destination?.lat ?? null, lng: destination?.lng ?? null, isDefault: n === 0 });
            }
          }
        } else {
          throw badRequest('address_required', tr('err.address_required'));
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
      if (missing.length) throw conflict('product_unavailable', tr('err.items_gone'), { missing });

      const level = levelFor(allLevels, u.pointsBalance).current;
      const quote = buildQuote(input, byId, settings, discount, level.multiplierPercent, {
        destination,
        addressReady: address != null,
        requireLocation: true,
      });
      // Delivery must have a validated location and a calculated fee (never a pending/$0 fee).
      if (quote.delivery && quote.delivery.status !== 'ok') {
        throw conflict(`delivery_${quote.delivery.status}`, quote.delivery.message ?? tr('price.no_delivery'), { delivery: quote.delivery });
      }
      if (!quote.canPlace) {
        throw conflict('cannot_place', quote.issues[0], { issues: quote.issues, lines: quote.lines.filter((l) => l.issue) });
      }
      if (discount.coupon && quote.couponError) throw conflict('coupon_invalid', quote.couponError);
      // Server-side check of what the customer reviewed: never charge a different fee or total.
      const effectiveFeeCents = quote.delivery ? quote.baseDeliveryFeeCents! - quote.deliveryDiscountCents : 0;
      const feeChanged =
        input.fulfillmentType === 'delivery' && input.expectedDeliveryFeeCents !== undefined && input.expectedDeliveryFeeCents !== effectiveFeeCents;
      const totalChanged = input.expectedTotalCents !== undefined && input.expectedTotalCents !== quote.totalCents;
      if (feeChanged || totalChanged) {
        throw conflict('price_changed', tr('err.price_changed', { total: formatMoney(quote.totalCents, settings.currency) }), {
          deliveryFeeCents: effectiveFeeCents,
          totalCents: quote.totalCents,
        });
      }

      // 5) Create the order and its lines.
      const now = new Date();
      const [order] = await tx
        .insert(orders)
        .values({
          userId: u.id,
          idempotencyKey: input.idempotencyKey,
          fulfillmentType: input.fulfillmentType,
          paymentMethod: input.paymentMethod,
          subtotalCents: quote.subtotalCents,
          discountCents: quote.discountCents,
          deliveryFeeCents: quote.baseDeliveryFeeCents ?? 0,
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
          deliveryLat: quote.delivery ? (destination?.lat ?? null) : null,
          deliveryLng: quote.delivery ? (destination?.lng ?? null) : null,
          deliveryDistanceKm: quote.delivery?.distanceKm ?? null,
          deliverySpeed: quote.delivery?.speed ?? null,
          deliveryDate: quote.delivery?.speed === 'next_day' ? cambodiaDate(now, 1) : null,
          customerNote: input.note || null,
          pointsEstimate: quote.pointsEstimate,
        })
        .returning();

      await tx.insert(orderItems).values(
        quote.lines.map((l) => ({
          orderId: order.id,
          productId: l.productId,
          name: l.name,
          nameEn: byId.get(l.productId)?.nameEn ?? null,
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
        if (!upd.length) throw conflict('out_of_stock', tr('err.sold_out', { name: byId.get(productId)?.name ?? tr('err.an_item') }));
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
        if (!counter.length) throw conflict('coupon_invalid', tr('err.coupon_exhausted'));
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
          if (!used.length) throw conflict('coupon_invalid', tr('err.reward_used'));
        }
      }

      // 8) Payment record (kept separate from fulfilment status).
      await tx.insert(payments).values({ orderId: order.id, provider: 'cash', amountCents: quote.totalCents, status: 'unpaid' });
      await tx.insert(orderEvents).values({ orderId: order.id, kind: 'status', status: 'placed', actorUserId: u.id, actorRole: 'customer' });

      // Remember the phone for next time if the profile doesn't have one yet.
      if (!u.phone) await tx.update(users).set({ phone: phone.display, phoneVerified: false }).where(eq(users.id, u.id));

      // 9) Notifications (outbox): the customer and every staff member.
      const lang = userLang(u);
      const total = formatMoney(quote.totalCents, settings.currency, lang);
      const how = tr(
        input.fulfillmentType === 'pickup' ? 'n.how_pickup' : quote.delivery?.speed === 'next_day' ? 'n.how_delivery_next_day' : 'n.how_delivery',
        {},
        lang,
      );
      await queueNotification(tx, {
        userId: u.id,
        chatId: u.telegramId,
        kind: 'order_placed',
        text:
          tr('n.placed', { code: orderCode(order.id), total, how }, lang) +
          (quote.pointsEstimate ? tr('n.will_earn', { n: quote.pointsEstimate }, lang) : ''),
        orderId: order.id,
        buttonText: tr('n.btn_track', {}, lang),
        buttonPath: `/orders/${order.id}`,
      });
      await notifyStaffNewOrder(tx, order.id);

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
