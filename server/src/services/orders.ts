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
import { applyPoints, syncMilestones } from './loyalty.js';
import { esc, kickNotifications, notifyStaff, queueNotification } from './notifications.js';
import { getSettings } from './settings.js';

export const DELIVERY_FLOW: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered'];
export const PICKUP_FLOW: OrderStatus[] = ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'collected'];
export const flowFor = (t: FulfillmentType) => (t === 'delivery' ? DELIVERY_FLOW : PICKUP_FLOW);
export const isCompleted = (s: OrderStatus) => s === 'delivered' || s === 'collected';
export const isTerminal = (s: OrderStatus) => isCompleted(s) || s === 'cancelled';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  placed: 'Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  ready_for_pickup: 'Ready for pickup',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ['paid', 'failed'],
  failed: ['paid', 'unpaid'],
  paid: ['refunded'],
  refunded: [],
};

/** Staff may move an order forward (skipping steps is allowed) or cancel it until it is complete. */
export function allowedNextStatuses(order: Pick<Order, 'status' | 'fulfillmentType'>): OrderStatus[] {
  if (isTerminal(order.status)) return [];
  // QR orders only move forward once payment is confirmed (see payments.ts / changePaymentStatus).
  if (order.status === 'awaiting_payment') return ['cancelled'];
  const flow = flowFor(order.fulfillmentType);
  const idx = flow.indexOf(order.status);
  return [...flow.slice(idx + 1), 'cancelled'];
}

export interface Actor {
  id: number | null;
  role: Role | 'system';
}


/** Alerts staff about an order that is ready to be handled (cash orders at once, QR orders after payment). */
export async function notifyStaffNewOrder(tx: Tx, orderId: number) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  const [{ n }] = await tx
    .select({ n: sql<number>`coalesce(sum(${orderItems.quantity}),0)::int` })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const settings = await getSettings(tx);
  const pay = o.paymentMethod === 'cash' ? '💵 Cash — collect on delivery/pickup' : '✅ Paid by QR';
  await notifyStaff(tx, {
    kind: 'staff_new_order',
    text: `🆕 <b>New order ${orderCode(o.id)}</b> — ${formatMoney(o.totalCents, settings.currency)}\n${n} items · ${o.fulfillmentType}\n${pay}\n👤 ${esc(o.contactName)} ${esc(o.contactPhone)}`,
    orderId: o.id,
    buttonText: 'Open in dashboard',
    buttonPath: `/admin/orders/${o.id}`,
  });
}

function customerMessage(order: Order, to: OrderStatus, settings: ShopSettings, extra: { points?: number; reason?: string | null }) {
  const code = orderCode(order.id);
  switch (to) {
    case 'confirmed':
      return `✅ Order <b>${code}</b> is confirmed! We're getting it ready.`;
    case 'preparing':
      return `🧺 We're picking and packing order <b>${code}</b>.`;
    case 'out_for_delivery':
      return `🚚 Order <b>${code}</b> is on its way to you!`;
    case 'ready_for_pickup':
      return `🛍️ Order <b>${code}</b> is ready for pickup${settings.pickupAddress ? ` at ${esc(settings.pickupAddress)}` : ''}.`;
    case 'delivered':
    case 'collected': {
      const verb = to === 'delivered' ? 'delivered' : 'collected';
      const pts = extra.points ? `\n⭐ <b>+${extra.points} points</b> added to your balance!` : '';
      return `📦 Order <b>${code}</b> ${verb}. Enjoy your groceries!${pts}`;
    }
    case 'cancelled':
      return `❌ Order <b>${code}</b> was cancelled.${extra.reason ? `\nReason: ${esc(extra.reason)}` : ''}`;
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
  for (const i of items) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) ?? 0) + i.quantity);
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
    if (!order || (args.asCustomer && order.userId !== args.actor.id)) throw notFound('Order not found.');
    if (order.status === args.to) return { changed: false, points: 0 }; // double-click safe

    if (args.asCustomer && !(args.to === 'cancelled' && (order.status === 'placed' || order.status === 'awaiting_payment'))) {
      throw conflict(
        'cannot_cancel',
        'The shop has already started on this order, so it can no longer be cancelled in the app. Please contact the shop.',
      );
    }
    const allowed = allowedNextStatuses(order);
    if (!allowed.includes(args.to)) {
      throw conflict(
        'invalid_transition',
        `Can't move order ${orderCode(order.id)} from "${STATUS_LABEL[order.status]}" to "${STATUS_LABEL[args.to]}".`,
        { allowed },
      );
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

    const text = customerMessage(order, args.to, settings, { points, reason: patch.cancelReason });
    if (text) {
      await queueNotification(tx, {
        userId: customer.id,
        chatId: customer.telegramId,
        kind: `order_${args.to}`,
        text,
        orderId: order.id,
        buttonText: '📍 View order',
        buttonPath: `/orders/${order.id}`,
      });
    }
    // Staff never saw unpaid QR orders, so only tell them about cancellations of orders they received.
    if (args.asCustomer && order.status !== 'awaiting_payment') {
      await notifyStaff(tx, {
        kind: 'staff_order_cancelled',
        text: `⚠️ Customer cancelled order <b>${orderCode(order.id)}</b>.`,
        orderId: order.id,
        buttonText: 'Open dashboard',
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
    if (!order) throw notFound('Order not found.');
    if (order.paymentStatus === args.to) return { changed: false, pointsReversed: 0 };
    if (!PAYMENT_TRANSITIONS[order.paymentStatus].includes(args.to)) {
      throw conflict('invalid_payment_transition', `Payment can't go from "${order.paymentStatus}" to "${args.to}".`, {
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

    if (args.to === 'paid' && order.status === 'awaiting_payment') {
      // Staff confirmed a QR payment the customer didn't report in the app → hand the order to the shop.
      await tx.update(orders).set({ status: 'placed' }).where(eq(orders.id, order.id));
      await tx.insert(orderEvents).values({ orderId: order.id, kind: 'status', status: 'placed', note: 'Payment confirmed by staff', actorUserId: args.actor.id, actorRole: args.actor.role });
    }
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
      await queueNotification(tx, {
        userId: customer.id,
        chatId: customer.telegramId,
        kind: 'order_refunded',
        text: `↩️ Refund processed for order <b>${orderCode(order.id)}</b>.${pointsReversed ? `\n${pointsReversed} points from this order were removed.` : ''}`,
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
  if (!o) throw notFound('Order not found.');
  await db.insert(orderEvents).values({ orderId, kind: 'note', note: note.trim(), actorUserId: actor.id, actorRole: actor.role });
}

// ---------- Read models ----------

type EventRow = typeof orderEvents.$inferSelect;

export function buildTimeline(order: Pick<Order, 'status' | 'fulfillmentType' | 'placedAt' | 'paymentMethod'>, events: EventRow[]) {
  const statusEvents = events.filter((e) => e.kind === 'status' && e.status);
  const paidByQr = order.paymentMethod === 'qr' || statusEvents.some((e) => e.status === 'awaiting_payment');
  const flow: OrderStatus[] = paidByQr ? ['awaiting_payment', ...flowFor(order.fulfillmentType)] : flowFor(order.fulfillmentType);
  const at = (s: OrderStatus) => statusEvents.filter((e) => e.status === s).at(-1)?.createdAt ?? (s === flow[0] ? order.placedAt : null);

  let reachedIdx = flow.indexOf(order.status);
  if (order.status === 'cancelled') {
    const lastBefore = [...statusEvents].reverse().find((e) => e.status !== 'cancelled' && flow.includes(e.status!));
    reachedIdx = lastBefore ? flow.indexOf(lastBefore.status!) : 0;
  }
  const steps = flow.map((s, i) => ({
    status: s,
    label: s === 'awaiting_payment' && i < reachedIdx ? 'Paid' : STATUS_LABEL[s],
    done: i <= reachedIdx,
    current: order.status !== 'cancelled' && i === reachedIdx,
    at: i <= reachedIdx ? at(s) : null,
  }));
  if (order.status === 'cancelled') {
    steps.splice(reachedIdx + 1, steps.length, {
      status: 'cancelled',
      label: STATUS_LABEL.cancelled,
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
    statusLabel: STATUS_LABEL[o.status],
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
  };
}

export async function getOrderDetail(orderId: number, opts: { forUserId?: number; staff?: boolean } = {}) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || (opts.forUserId != null && order.userId !== opts.forUserId)) throw notFound('Order not found.');
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
    discountLabel: order.discountLabel,
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
    pickup: order.fulfillmentType === 'pickup' ? { address: settings.pickupAddress, hours: settings.pickupHours } : null,
    customerNote: order.customerNote,
    cancelReason: order.cancelReason,
    cancelledBy: order.cancelledBy,
    canCancel: order.status === 'placed' || order.status === 'awaiting_payment',
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
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
  const [payment] = await db.select().from(payments).where(eq(payments.orderId, orderId));
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
    payment: payment
      ? {
          provider: payment.provider,
          reference: payment.reference,
          expiresAt: payment.expiresAt,
          paidAt: payment.paidAt,
          providerRef: payment.providerRef,
        }
      : null,
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
