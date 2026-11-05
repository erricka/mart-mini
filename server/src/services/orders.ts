import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import {
  couponRedemptions,
  coupons,
  customerRewards,
  inventoryMovements,
  notifications,
  orderEvents,
  orderItems,
  orders,
  payments,
  products,
  users,
  type FulfillmentType,
  type Order,
  type OrderStatus,
  type PaymentStatus,
  type Role,
  type ShopSettings,
  type User,
} from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { formatMoney, orderCode } from '../lib/format.js';
import { googleMapsDirections, googleMapsPin } from '../lib/geo.js';
import { pick, tr, userLang, type Lang } from '../lib/i18n.js';
import { applyPoints, syncMilestones } from './loyalty.js';
import { esc, kickNotifications, notifyStaff, queueNotification } from './notifications.js';
import { getSettings } from './settings.js';

export const DELIVERY_FLOW: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
export const PICKUP_FLOW: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'collected'];
export const flowFor = (t: FulfillmentType) => (t === 'delivery' ? DELIVERY_FLOW : PICKUP_FLOW);
export const isCompleted = (s: OrderStatus) => s === 'delivered' || s === 'collected';
export const isTerminal = (s: OrderStatus) => isCompleted(s) || s === 'cancelled';

/** Status label in the current request's language. */
export const statusLabel = (s: OrderStatus, lang?: Lang) => tr(`status.${s}`, {}, lang);

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ['paid', 'failed'],
  failed: ['paid', 'unpaid'],
  paid: ['refunded'],
  refunded: [],
};

/** Staff may move an order forward (skipping steps is allowed) or cancel it until it is complete. */
export function allowedNextStatuses(order: Pick<Order, 'status' | 'fulfillmentType'>): OrderStatus[] {
  if (isTerminal(order.status)) return [];
  const flow = flowFor(order.fulfillmentType);
  const idx = flow.indexOf(order.status);
  return [...flow.slice(idx + 1), 'cancelled'];
}

export interface Actor {
  id: number | null;
  role: Role | 'system';
}


/** Alerts every staff member (in their own language) about a new order to handle. */
export async function notifyStaffNewOrder(tx: Tx, orderId: number) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  const [{ n }] = await tx
    .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int` })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const settings = await getSettings(tx);
  await notifyStaff(tx, {
    kind: 'staff_new_order',
    text: (lang) =>
      tr(
        'n.staff_new_order',
        {
          code: orderCode(o.id),
          total: formatMoney(o.totalCents, settings.currency, lang),
          n,
          how: tr(o.fulfillmentType === 'delivery' ? 'n.how_delivery' : 'n.how_pickup', {}, lang),
          pay: tr(o.paymentStatus === 'paid' ? 'n.pay_paid' : 'n.pay_cash', {}, lang),
          name: esc(o.contactName),
          phone: esc(o.contactPhone),
        },
        lang,
      ) + deliveryLines(o, settings, lang),
    orderId: o.id,
    buttonText: (lang) => tr('n.btn_open_dashboard', {}, lang),
    buttonPath: `/admin/orders/${o.id}`,
  });
}

/** Staff alert extras for delivery: when to deliver and a map link for the driver. */
function deliveryLines(o: Order, settings: ShopSettings, lang: Lang) {
  if (o.fulfillmentType !== 'delivery') return '';
  const lines: string[] = [];
  if (o.deliverySpeed === 'next_day') lines.push(tr('n.staff_when_next_day', { date: o.deliveryDate ?? '' }, lang));
  else if (o.deliverySpeed === 'same_day') lines.push(tr('n.staff_when_same_day', {}, lang));
  if (o.deliveryLat != null && o.deliveryLng != null) {
    const store = settings.storeLat != null && settings.storeLng != null ? { lat: settings.storeLat, lng: settings.storeLng } : null;
    const url = googleMapsDirections(store, { lat: o.deliveryLat, lng: o.deliveryLng });
    lines.push(tr('n.staff_map', { url: esc(url), km: o.deliveryDistanceKm ?? '?' }, lang));
  }
  return lines.length ? `\n${lines.join('\n')}` : '';
}

function customerMessage(order: Order, to: OrderStatus, settings: ShopSettings, lang: Lang, extra: { points?: number; reason?: string | null }) {
  const code = orderCode(order.id);
  switch (to) {
    case 'confirmed':
    case 'preparing':
    case 'out_for_delivery':
      return tr(`n.${to}`, { code }, lang);
    case 'ready_for_pickup':
      return tr('n.ready_for_pickup', { code, where: settings.pickupAddress ? tr('n.pickup_where', { address: esc(settings.pickupAddress) }, lang) : '' }, lang);
    case 'delivered':
    case 'collected':
      return tr(`n.${to}`, { code }, lang) + (extra.points ? tr('n.points_added', { n: extra.points }, lang) : '');
    case 'cancelled':
      return tr('n.cancelled', { code }, lang) + (extra.reason ? tr('n.reason', { reason: esc(extra.reason) }, lang) : '');
    default:
      return null;
  }
}

/** Puts stock, coupon usage and wallet rewards back when an order is cancelled. Lock order: coupons → rewards → products. */
async function releaseOrderResources(tx: Tx, order: Order, actorUserId: number | null) {
  const now = new Date();
  const released = await tx
    .update(couponRedemptions)
    .set({ status: 'released', releasedAt: now })
    .where(and(eq(couponRedemptions.orderId, order.id), eq(couponRedemptions.status, 'active')))
    .returning({ couponId: couponRedemptions.couponId });
  for (const r of released) {
    await tx
      .update(coupons)
      .set({ redeemedCount: sql`greatest(${coupons.redeemedCount} - 1, 0)` })
      .where(eq(coupons.id, r.couponId));
  }
  await tx
    .update(customerRewards)
    .set({ status: 'available', usedAt: null, orderId: null })
    .where(and(eq(customerRewards.orderId, order.id), eq(customerRewards.status, 'used')));

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const qtyByProduct = new Map<number, number>();
  // Deleted products (productId null) have no stock to put back.
  for (const i of items) if (i.productId != null) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) ?? 0) + i.quantity);
  for (const [productId, qty] of [...qtyByProduct.entries()].sort((a, b) => a[0] - b[0])) {
    const [p] = await tx
      .update(products)
      .set({ stock: sql`${products.stock} + ${qty}`, updatedAt: now })
      .where(eq(products.id, productId))
      .returning({ stock: products.stock });
    await tx.insert(inventoryMovements).values({
      productId,
      delta: qty,
      stockAfter: p.stock,
      reason: 'cancel',
      orderId: order.id,
      actorUserId,
      note: `Order ${orderCode(order.id)} cancelled`,
    });
  }
}

async function awardOrderPoints(tx: Tx, order: Order, user: User, settings: ShopSettings) {
  if (order.paymentStatus === 'refunded' || order.pointsEstimate <= 0) return 0;
  const r = await applyPoints(tx, {
    userId: order.userId,
    delta: order.pointsEstimate,
    type: 'order_earn',
    idempotencyKey: `order:${order.id}:earn`,
    orderId: order.id,
    note: `Order ${orderCode(order.id)}`,
  });
  if (!r.applied) return 0;
  await tx.update(orders).set({ pointsAwarded: order.pointsEstimate }).where(eq(orders.id, order.id));
  await syncMilestones(tx, user, r.balance, { notify: true, settings });
  return order.pointsEstimate;
}

export async function changeOrderStatus(args: {
  orderId: number;
  to: OrderStatus;
  actor: Actor;
  note?: string | null;
  reason?: string | null;
  /** Set when a customer acts on their own order (only cancelling a still-"placed" order is allowed). */
  asCustomer?: boolean;
}) {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, args.orderId)).for('update');
    if (!order || (args.asCustomer && order.userId !== args.actor.id)) throw notFound(tr('err.order_not_found'));
    if (order.status === args.to) return { changed: false, points: 0 }; // double-click safe

    if (args.asCustomer && !(args.to === 'cancelled' && order.status === 'placed')) {
      throw conflict('cannot_cancel', tr('err.cannot_cancel'));
    }
    const allowed = allowedNextStatuses(order);
    if (!allowed.includes(args.to)) {
      throw conflict('invalid_transition', tr('err.invalid_transition', { code: orderCode(order.id), from: statusLabel(order.status), to: statusLabel(args.to) }), {
        allowed,
      });
    }

    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = { status: args.to, updatedAt: now };
    if (args.to === 'cancelled') {
      patch.cancelledAt = now;
      patch.cancelReason = args.reason?.trim() || null;
      patch.cancelledBy = args.asCustomer ? 'customer' : 'staff';
    }
    if (isCompleted(args.to)) patch.completedAt = now;
    await tx.update(orders).set(patch).where(eq(orders.id, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      kind: 'status',
      status: args.to,
      note: args.note?.trim() || args.reason?.trim() || null,
      actorUserId: args.actor.id,
      actorRole: args.asCustomer ? 'customer' : args.actor.role,
    });

    const settings = await getSettings(tx);
    const [customer] = await tx.select().from(users).where(eq(users.id, order.userId));
    let points = 0;
    if (args.to === 'cancelled') await releaseOrderResources(tx, order, args.actor.id);
    if (isCompleted(args.to)) points = await awardOrderPoints(tx, order, customer, settings);

    const lang = userLang(customer);
    const text = customerMessage(order, args.to, settings, lang, { points, reason: patch.cancelReason });
    if (text) {
      await queueNotification(tx, {
        userId: customer.id,
        chatId: customer.telegramId,
        kind: `order_${args.to}`,
        text,
        orderId: order.id,
        buttonText: tr('n.btn_view', {}, lang),
        buttonPath: `/orders/${order.id}`,
      });
    }
    if (args.asCustomer) {
      await notifyStaff(tx, {
        kind: 'staff_order_cancelled',
        text: (l) => tr('n.staff_cancelled', { code: orderCode(order.id) }, l),
        orderId: order.id,
        buttonText: (l) => tr('n.btn_dashboard', {}, l),
        buttonPath: `/admin/orders/${order.id}`,
      });
    }
    return { changed: true, points };
  });
  kickNotifications();
  return result;
}

export async function changePaymentStatus(args: { orderId: number; to: PaymentStatus; actor: Actor; note?: string | null }) {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, args.orderId)).for('update');
    if (!order) throw notFound(tr('err.order_not_found'));
    if (order.paymentStatus === args.to) return { changed: false, pointsReversed: 0 };
    if (!PAYMENT_TRANSITIONS[order.paymentStatus].includes(args.to)) {
      throw conflict('invalid_payment_transition', tr('err.invalid_payment', { from: tr(`pay.${order.paymentStatus}`), to: tr(`pay.${args.to}`) }), {
        allowed: PAYMENT_TRANSITIONS[order.paymentStatus],
      });
    }
    const now = new Date();
    await tx.update(orders).set({ paymentStatus: args.to, updatedAt: now }).where(eq(orders.id, order.id));
    await tx.update(payments).set({ status: args.to, updatedAt: now }).where(eq(payments.orderId, order.id));
    await tx.insert(orderEvents).values({
      orderId: order.id,
      kind: 'payment',
      paymentStatus: args.to,
      note: args.note?.trim() || null,
      actorUserId: args.actor.id,
      actorRole: args.actor.role,
    });

    if (args.to === 'paid') await tx.update(payments).set({ paidAt: now }).where(eq(payments.orderId, order.id));
    let pointsReversed = 0;
    if (args.to === 'refunded') {
      const [customer] = await tx.select().from(users).where(eq(users.id, order.userId));
      if (order.pointsAwarded > 0 && order.pointsReversed === 0) {
        const r = await applyPoints(tx, {
          userId: order.userId,
          delta: -order.pointsAwarded,
          type: 'order_reversal',
          idempotencyKey: `order:${order.id}:reversal`,
          orderId: order.id,
          note: `Refund of order ${orderCode(order.id)}`,
          actorUserId: args.actor.id,
        });
        if (r.applied) {
          pointsReversed = order.pointsAwarded;
          await tx.update(orders).set({ pointsReversed }).where(eq(orders.id, order.id));
          await syncMilestones(tx, customer, r.balance);
        }
      }
      const lang = userLang(customer);
      await queueNotification(tx, {
        userId: customer.id,
        chatId: customer.telegramId,
        kind: 'order_refunded',
        text: tr('n.refunded', { code: orderCode(order.id) }, lang) + (pointsReversed ? tr('n.refund_points', { n: pointsReversed }, lang) : ''),
        orderId: order.id,
      });
    }
    return { changed: true, pointsReversed };
  });
  kickNotifications();
  return result;
}

export async function addOrderNote(orderId: number, actor: Actor, note: string) {
  const [o] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
  if (!o) throw notFound(tr('err.order_not_found'));
  await db.insert(orderEvents).values({ orderId, kind: 'note', note: note.trim(), actorUserId: actor.id, actorRole: actor.role });
}

// ---------- Read models ----------

type EventRow = typeof orderEvents.$inferSelect;

export function buildTimeline(order: Pick<Order, 'status' | 'fulfillmentType' | 'placedAt'>, events: EventRow[]) {
  const statusEvents = events.filter((e) => e.kind === 'status' && e.status);
  const flow = flowFor(order.fulfillmentType);
  const at = (s: OrderStatus) => statusEvents.filter((e) => e.status === s).at(-1)?.createdAt ?? (s === flow[0] ? order.placedAt : null);

  let reachedIdx = flow.indexOf(order.status);
  if (order.status === 'cancelled') {
    const lastBefore = [...statusEvents].reverse().find((e) => e.status !== 'cancelled' && flow.includes(e.status!));
    reachedIdx = lastBefore ? flow.indexOf(lastBefore.status!) : 0;
  }
  const steps = flow.map((s, i) => ({
    status: s,
    label: statusLabel(s),
    done: i <= reachedIdx,
    current: order.status !== 'cancelled' && i === reachedIdx,
    at: i <= reachedIdx ? at(s) : null,
  }));
  if (order.status === 'cancelled') {
    steps.splice(reachedIdx + 1, steps.length, {
      status: 'cancelled',
      label: statusLabel('cancelled'),
      done: true,
      current: true,
      at: at('cancelled'),
    });
  }
  return steps;
}

export function serializeOrderSummary(o: Order, itemCount?: number) {
  return {
    id: o.id,
    code: orderCode(o.id),
    status: o.status,
    statusLabel: statusLabel(o.status),
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    fulfillmentType: o.fulfillmentType,
    totalCents: o.totalCents,
    itemCount: itemCount ?? null,
    pointsEstimate: o.pointsEstimate,
    pointsAwarded: o.pointsAwarded,
    pointsReversed: o.pointsReversed,
    placedAt: o.placedAt,
    completedAt: o.completedAt,
    cancelledAt: o.cancelledAt,
    contactName: o.contactName,
    deliverySpeed: o.deliverySpeed,
    deliveryDate: o.deliveryDate,
  };
}

export async function getOrderDetail(orderId: number, opts: { forUserId?: number; staff?: boolean } = {}) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || (opts.forUserId != null && order.userId !== opts.forUserId)) throw notFound(tr('err.order_not_found'));
  const [coupon] = order.couponId ? await db.select().from(coupons).where(eq(coupons.id, order.couponId)) : [];
  const [items, events, settings] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.isGift), asc(orderItems.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId)).orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
    getSettings(),
  ]);

  const base = {
    ...serializeOrderSummary(order, items.reduce((n, i) => n + i.quantity, 0)),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    deliveryFeeCents: order.deliveryFeeCents,
    discountLabel: coupon ? pick(coupon.title, coupon.titleEn) : order.discountLabel,
    contactPhone: order.contactPhone,
    address:
      order.fulfillmentType === 'delivery'
        ? {
            line1: order.addressLine1,
            line2: order.addressLine2,
            city: order.city,
            postalCode: order.postalCode,
            instructions: order.addressInstructions,
          }
        : null,
    delivery:
      order.fulfillmentType === 'delivery'
        ? {
            speed: order.deliverySpeed,
            date: order.deliveryDate,
            distanceKm: order.deliveryDistanceKm,
            pin: order.deliveryLat != null && order.deliveryLng != null ? { lat: order.deliveryLat, lng: order.deliveryLng } : null,
            mapUrl: order.deliveryLat != null && order.deliveryLng != null ? googleMapsPin({ lat: order.deliveryLat, lng: order.deliveryLng }) : null,
            directionsUrl:
              order.deliveryLat != null && order.deliveryLng != null
                ? googleMapsDirections(
                    settings.storeLat != null && settings.storeLng != null ? { lat: settings.storeLat, lng: settings.storeLng } : null,
                    { lat: order.deliveryLat, lng: order.deliveryLng },
                  )
                : null,
          }
        : null,
    pickup: order.fulfillmentType === 'pickup' ? { address: settings.pickupAddress, hours: settings.pickupHours } : null,
    customerNote: order.customerNote,
    cancelReason: order.cancelReason,
    cancelledBy: order.cancelledBy,
    canCancel: order.status === 'placed',
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: pick(i.name, i.nameEn),
      unit: i.unit,
      emoji: i.emoji,
      imageUrl: i.imageUrl,
      unitPriceCents: i.unitPriceCents,
      quantity: i.quantity,
      lineTotalCents: i.lineTotalCents,
      isGift: i.isGift,
    })),
    timeline: buildTimeline(order, events),
    currency: settings.currency,
    supportPhone: settings.supportPhone,
  };
  if (!opts.staff) return base;

  const [customer] = await db.select().from(users).where(eq(users.id, order.userId));
  const [{ orderCount }] = await db
    .select({ orderCount: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.userId, order.userId));
  const notes = await db
    .select()
    .from(notifications)
    .where(eq(notifications.orderId, orderId))
    .orderBy(desc(notifications.id))
    .limit(30);
  return {
    ...base,
    allowedNext: allowedNextStatuses(order),
    allowedPayment: PAYMENT_TRANSITIONS[order.paymentStatus],
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      paymentStatus: e.paymentStatus,
      note: e.note,
      actorRole: e.actorRole,
      createdAt: e.createdAt,
    })),
    customer: {
      id: customer.id,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
      username: customer.username,
      telegramId: customer.telegramId,
      phone: customer.phone,
      phoneVerified: customer.phoneVerified,
      photoUrl: customer.photoUrl,
      pointsBalance: customer.pointsBalance,
      orderCount,
    },
    notifications: notes.map((n) => ({ id: n.id, kind: n.kind, status: n.status, createdAt: n.createdAt, lastError: n.lastError })),
  };
}

export const orderTotalLabel = (o: Order, currency: string) => formatMoney(o.totalCents, currency);
