/**
 * QR payments.
 *
 * Flow: a QR order is created as `awaiting_payment` (stock reserved, shop NOT alerted). When the customer
 * opens the payment screen we ask the provider for a QR (`ensureCharge`). Once the provider confirms
 * payment (`confirmQrPayment`, from a callback or a status check) the order becomes `placed` and the
 * shop is notified. Unpaid orders are cancelled after `paymentWindowMinutes`, releasing stock.
 *
 * Providers:
 *  - simulated  — DEVELOPMENT ONLY, clearly labelled. The QR opens a "simulated payment" page.
 *  - aba_payway — PLACEHOLDER for the shop's ABA PayWay API (see ./providers/aba-payway.ts).
 */
import { randomBytes } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db, type Tx } from '../db/client.js';
import { orderEvents, orders, payments, users, type Order, type ShopSettings } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { formatMoney, orderCode } from '../lib/format.js';
import { kickNotifications, queueNotification } from './notifications.js';
import { changeOrderStatus, notifyStaffNewOrder, type Actor } from './orders.js';
import { abaPayway } from './providers/aba-payway.js';
import type { QrPaymentProvider } from './providers/types.js';
import { getSettings } from './settings.js';

const SYSTEM: Actor = { id: null, role: 'system' };

const simulated: QrPaymentProvider = {
  id: 'simulated',
  label: 'Simulated QR (demo)',
  isConfigured: () => config.allowSimulatedPayments,
  async createCharge({ token }) {
    return { qrPayload: new URL(`/api/payments/simulate/${token}`, config.PUBLIC_URL).toString() };
  },
};

const providers: Record<string, QrPaymentProvider> = { simulated, aba_payway: abaPayway };

export function qrProvider(settings: ShopSettings): QrPaymentProvider | null {
  if (settings.qrPaymentMode === 'off') return null;
  const p = providers[settings.qrPaymentMode];
  return p?.isConfigured() ? p : null;
}

export const qrModeUsable = (settings: ShopSettings) => qrProvider(settings) != null;

export function providerStatus() {
  return Object.values(providers).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() }));
}

export const paymentReference = (orderId: number) => `SM${String(orderId).padStart(6, '0')}`;

/** Inside the order transaction: create the payment row. The provider QR is requested later (ensureCharge). */
export async function createQrPaymentRecord(tx: Tx, order: Order, settings: ShopSettings) {
  const provider = qrProvider(settings);
  if (!provider) throw badRequest('payment_unavailable', 'QR payment is not available right now. Please choose cash.');
  const expiresAt = new Date(Date.now() + settings.paymentWindowMinutes * 60_000);
  await tx.insert(payments).values({
    orderId: order.id,
    provider: provider.id,
    amountCents: order.totalCents,
    status: 'unpaid',
    checkoutToken: randomBytes(24).toString('base64url'),
    reference: paymentReference(order.id),
    expiresAt,
  });
  return { expiresAt };
}

/** Requests the QR from the provider once (row lock prevents double charges), outside the order transaction. */
async function ensureCharge(orderId: number) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ payment: payments, order: orders })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.orderId, orderId))
      .for('update', { of: payments });
    if (!row || row.payment.qrPayload || row.order.status !== 'awaiting_payment' || row.payment.status !== 'unpaid') return;
    const provider = providers[row.payment.provider];
    if (!provider?.isConfigured()) return;
    const [customer] = await tx.select().from(users).where(eq(users.id, row.order.userId));
    const settings = await getSettings(tx);
    const charge = await provider.createCharge({
      orderId,
      reference: row.payment.reference!,
      token: row.payment.checkoutToken!,
      amountCents: row.order.totalCents,
      currency: settings.currency,
      expiresAt: row.payment.expiresAt!,
      customer: { firstName: customer.firstName, lastName: customer.lastName, phone: row.order.contactPhone },
      callbackUrl: new URL(`/api/payments/${provider.id}/callback`, config.PUBLIC_URL).toString(),
    });
    await tx
      .update(payments)
      .set({ qrPayload: charge.qrPayload, appLink: charge.appLink ?? null, providerRef: charge.providerRef ?? null, updatedAt: new Date() })
      .where(eq(payments.id, row.payment.id));
  });
}

async function lockOrder(tx: Tx, orderId: number) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw notFound('Order not found.');
  return order;
}

/** Hands an order that was waiting for payment over to the shop. */
async function releaseToShop(tx: Tx, order: Order, actor: Actor, note: string) {
  await tx.update(orders).set({ status: 'placed', updatedAt: new Date() }).where(eq(orders.id, order.id));
  await tx.insert(orderEvents).values({ orderId: order.id, kind: 'status', status: 'placed', note, actorUserId: actor.id, actorRole: actor.role });
  await notifyStaffNewOrder(tx, order.id);
}

/**
 * Payment confirmed by the provider (callback / status check) or the simulator. Idempotent: confirming
 * twice is a no-op. The order then reaches the shop.
 */
export async function confirmQrPayment(orderId: number, opts: { actor?: Actor; note: string; providerRef?: string }) {
  const actor = opts.actor ?? SYSTEM;
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.paymentStatus === 'paid') return { changed: false };
    if (order.status === 'cancelled') throw conflict('payment_closed', 'This order was cancelled, so the payment session is closed.');
    if (order.paymentStatus !== 'unpaid' && order.paymentStatus !== 'failed') {
      throw conflict('invalid_payment_transition', `Payment is already ${order.paymentStatus}.`);
    }
    const now = new Date();
    await tx.update(orders).set({ paymentStatus: 'paid', updatedAt: now }).where(eq(orders.id, order.id));
    await tx
      .update(payments)
      .set({ status: 'paid', paidAt: now, updatedAt: now, ...(opts.providerRef ? { providerRef: opts.providerRef } : {}) })
      .where(eq(payments.orderId, order.id));
    await tx.insert(orderEvents).values({ orderId: order.id, kind: 'payment', paymentStatus: 'paid', note: opts.note, actorUserId: actor.id, actorRole: actor.role });
    if (order.status === 'awaiting_payment') {
      await releaseToShop(tx, order, actor, 'Payment received — sent to the shop');
      const [customer] = await tx.select().from(users).where(eq(users.id, order.userId));
      await queueNotification(tx, {
        userId: customer.id,
        chatId: customer.telegramId,
        kind: 'payment_received',
        text: `💳 Payment received for order <b>${orderCode(order.id)}</b> — the shop has your order now!`,
        orderId: order.id,
        buttonText: '📍 Track order',
        buttonPath: `/orders/${order.id}`,
      });
    }
    return { changed: true };
  });
  kickNotifications();
  return result;
}

/** "Pay with cash instead" from the payment screen. */
export async function switchToCash(orderId: number, userId: number) {
  const result = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.userId !== userId) throw notFound('Order not found.');
    if (order.paymentMethod === 'cash') return { changed: false };
    if (order.status !== 'awaiting_payment' || order.paymentStatus !== 'unpaid') {
      throw conflict('not_awaiting', 'This order can no longer switch payment method.');
    }
    const settings = await getSettings(tx);
    if (!settings.cashEnabled) throw badRequest('cash_disabled', 'Cash payment is not available.');
    await tx.update(orders).set({ paymentMethod: 'cash', updatedAt: new Date() }).where(eq(orders.id, order.id));
    await tx.update(payments).set({ provider: 'cash', expiresAt: null, qrPayload: null, appLink: null, updatedAt: new Date() }).where(eq(payments.orderId, order.id));
    await tx.insert(orderEvents).values({ orderId: order.id, kind: 'payment', paymentStatus: 'unpaid', note: 'Customer switched to cash payment', actorUserId: userId, actorRole: 'customer' });
    await releaseToShop(tx, order, { id: userId, role: 'customer' }, 'Customer chose cash instead of QR');
    return { changed: true };
  });
  kickNotifications();
  return result;
}

export async function simulatePaymentByToken(token: string) {
  if (!config.allowSimulatedPayments) throw notFound();
  const [p] = await db.select().from(payments).where(eq(payments.checkoutToken, token));
  if (!p || p.provider !== 'simulated') throw notFound('Payment session not found.');
  if (p.expiresAt && p.expiresAt < new Date() && p.status !== 'paid') throw conflict('expired', 'This payment session has expired.');
  await confirmQrPayment(p.orderId, { note: 'SIMULATED QR payment — demo only, no money was charged.', providerRef: `SIM-${Date.now()}` });
  return p.orderId;
}

export async function getPaymentSession(orderId: number, userId: number) {
  const [owned] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!owned) throw notFound('Order not found.');
  let providerError: string | null = null;
  try {
    await ensureCharge(orderId);
  } catch (err) {
    providerError = err instanceof Error ? err.message : 'Payment provider error';
  }
  const [row] = await db
    .select({ order: orders, payment: payments })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(orders.id, orderId));
  const settings = await getSettings();
  const { order, payment } = row;
  const provider = providers[payment.provider];
  return {
    orderId: order.id,
    code: orderCode(order.id),
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    amountCents: order.totalCents,
    amountLabel: formatMoney(order.totalCents, settings.currency),
    provider: payment.provider,
    providerLabel: provider?.label ?? payment.provider,
    simulated: payment.provider === 'simulated',
    reference: payment.reference,
    expiresAt: payment.expiresAt,
    qrImageUrl: payment.checkoutToken && payment.qrPayload && order.status === 'awaiting_payment' ? `/api/payments/qr/${payment.checkoutToken}.png` : null,
    appLink: order.status === 'awaiting_payment' ? payment.appLink : null,
    instructions: settings.qrPaymentInstructions,
    cashEnabled: settings.cashEnabled,
    providerError,
  };
}

/** Cancels QR orders whose payment window has passed (stock, coupons and rewards are released). */
export async function expireUnpaidOrders() {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(and(eq(orders.status, 'awaiting_payment'), sql`${payments.status} in ('unpaid','failed')`, lt(payments.expiresAt, new Date())))
    .limit(50);
  for (const o of due) {
    try {
      await changeOrderStatus({ orderId: o.id, to: 'cancelled', actor: SYSTEM, reason: 'Payment was not completed in time' });
    } catch {
      /* already changed concurrently */
    }
  }
  return due.length;
}

export function startPaymentExpiryWorker() {
  const t = setInterval(() => void expireUnpaidOrders().catch(() => {}), 30_000);
  t.unref();
  return () => clearInterval(t);
}
