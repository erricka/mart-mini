import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { addresses, orderItems, orders, payments, users } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { limit } from '../lib/rate-limit.js';
import { idParam, parse } from '../lib/validate.js';
import { makeGuards } from '../plugins/auth.js';
import { addressInputSchema, cartSchema, placeOrderSchema, placeOrder, quoteCart } from '../services/checkout.js';
import { publicUser, resolvePhoneInput } from '../services/identity.js';
import { availableDiscounts, loyaltyOverview, markRewardsSeen } from '../services/loyalty.js';
import { changeOrderStatus, getOrderDetail, serializeOrderSummary } from '../services/orders.js';
import { getPaymentSession, simulatePaymentByToken, switchToCash } from '../services/payments.js';
import { getLevels, levelFor } from '../services/settings.js';

export async function customerRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);
  app.addHook('preHandler', guard.customer);

  // ---------- Profile ----------
  app.get('/me', async (req) => {
    const u = req.account!;
    const { current, next } = levelFor(await getLevels(), u.pointsBalance);
    const [stats] = await db
      .select({ orderCount: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, u.id));
    return { user: publicUser(u), level: current, nextLevel: next, orderCount: stats.orderCount };
  });

  app.patch('/me', async (req) => {
    const body = parse(
      z.object({
        firstName: z.string().trim().min(1, 'Please enter your name.').max(64).optional(),
        lastName: z.string().trim().max(64).optional().nullable(),
      }),
      req.body,
    );
    const [u] = await db
      .update(users)
      .set({ ...body, lastName: body.lastName === undefined ? undefined : body.lastName || null, updatedAt: new Date() })
      .where(eq(users.id, req.account!.id))
      .returning();
    return { user: publicUser(u) };
  });

  app.put('/me/phone', async (req) => {
    const body = parse(
      z.object({ phone: z.string().trim().max(30).optional().nullable(), contactResponse: z.string().max(8192).optional().nullable() }),
      req.body,
    );
    const { phone, verified } = resolvePhoneInput(req.account!.telegramId, body);
    const [u] = await db
      .update(users)
      .set({ phone: phone?.display ?? null, phoneVerified: verified, updatedAt: new Date() })
      .where(eq(users.id, req.account!.id))
      .returning();
    return { user: publicUser(u) };
  });

  // ---------- Addresses ----------
  app.get('/me/addresses', async (req) => {
    const rows = await db
      .select()
      .from(addresses)
      .where(eq(addresses.userId, req.account!.id))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
    return { addresses: rows };
  });

  const addressBody = addressInputSchema.extend({ isDefault: z.boolean().optional() });

  app.post('/me/addresses', async (req) => {
    const body = parse(addressBody, req.body);
    const userId = req.account!.id;
    return db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(addresses).where(eq(addresses.userId, userId));
      if (n >= 10) throw badRequest('too_many_addresses', 'You can save up to 10 addresses.');
      const isDefault = body.isDefault ?? n === 0;
      if (isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
      const [a] = await tx
        .insert(addresses)
        .values({ ...body, userId, isDefault, line2: body.line2 || null, postalCode: body.postalCode || null, instructions: body.instructions || null })
        .returning();
      return { address: a };
    });
  });

  app.put('/me/addresses/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(addressBody, req.body);
    const userId = req.account!.id;
    return db.transaction(async (tx) => {
      if (body.isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
      const [a] = await tx
        .update(addresses)
        .set({ ...body, line2: body.line2 || null, postalCode: body.postalCode || null, instructions: body.instructions || null })
        .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        .returning();
      if (!a) throw notFound('Address not found.');
      return { address: a };
    });
  });

  app.delete('/me/addresses/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const userId = req.account!.id;
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(addresses)
        .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        .returning();
      if (!deleted) throw notFound('Address not found.');
      if (deleted.isDefault) {
        const [next] = await tx.select().from(addresses).where(eq(addresses.userId, userId)).limit(1);
        if (next) await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
      }
    });
    return { ok: true };
  });

  // ---------- Checkout ----------
  app.post('/checkout/quote', { config: limit(120) }, async (req) => {
    const body = parse(cartSchema, req.body);
    const [quote, discounts] = await Promise.all([quoteCart(req.account!, body), availableDiscounts(req.account!.id)]);
    return {
      quote,
      discounts: {
        wallet: discounts.wallet.filter((w) => w.status === 'available'),
        publicCoupons: discounts.publicCoupons,
      },
    };
  });

  app.post('/orders', { config: limit(10) }, async (req, reply) => {
    const body = parse(placeOrderSchema, req.body);
    const { orderId, replayed } = await placeOrder(req.account!, body);
    const order = await getOrderDetail(orderId, { forUserId: req.account!.id });
    return reply.status(replayed ? 200 : 201).send({ order, replayed });
  });

  app.get('/orders', async (req) => {
    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, req.account!.id))
      .orderBy(desc(orders.placedAt))
      .limit(100);
    const counts = rows.length
      ? await db
          .select({ orderId: orderItems.orderId, n: sql<number>`sum(${orderItems.quantity})::int` })
          .from(orderItems)
          .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
          .groupBy(orderItems.orderId)
      : [];
    const byId = new Map(counts.map((c) => [c.orderId, c.n]));
    const preview = rows.length
      ? await db
          .select({ orderId: orderItems.orderId, emoji: orderItems.emoji })
          .from(orderItems)
          .where(and(inArray(orderItems.orderId, rows.map((r) => r.id)), eq(orderItems.isGift, false)))
      : [];
    const emojis = new Map<number, string[]>();
    for (const p of preview) emojis.set(p.orderId, [...(emojis.get(p.orderId) ?? []), p.emoji].slice(0, 4));
    return {
      orders: rows.map((o) => ({ ...serializeOrderSummary(o, byId.get(o.id) ?? 0), preview: emojis.get(o.id) ?? [] })),
      activeCount: rows.filter((o) => !['delivered', 'collected', 'cancelled'].includes(o.status)).length,
    };
  });

  app.get('/orders/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return { order: await getOrderDetail(id, { forUserId: req.account!.id }) };
  });

  app.post('/orders/:id/cancel', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ reason: z.string().trim().max(300).optional().nullable() }), req.body);
    await changeOrderStatus({ orderId: id, to: 'cancelled', actor: req.account!, reason: body.reason ?? 'Cancelled by customer', asCustomer: true });
    return { order: await getOrderDetail(id, { forUserId: req.account!.id }) };
  });

  // ---------- QR payment ----------
  app.get('/orders/:id/payment', async (req) => {
    const { id } = parse(idParam, req.params);
    return { payment: await getPaymentSession(id, req.account!.id) };
  });

  app.post('/orders/:id/payment/cash', { config: limit(20) }, async (req) => {
    const { id } = parse(idParam, req.params);
    await switchToCash(id, req.account!.id);
    return { payment: await getPaymentSession(id, req.account!.id) };
  });

  /** DEMO: the in-app "simulate payment" button (same as scanning the simulated QR). */
  app.post('/orders/:id/payment/simulate', { config: limit(20) }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [p] = await db
      .select({ token: payments.checkoutToken })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(eq(payments.orderId, id), eq(orders.userId, req.account!.id)));
    if (!p?.token) throw notFound('Order not found.');
    await simulatePaymentByToken(p.token);
    return { payment: await getPaymentSession(id, req.account!.id) };
  });

  // ---------- Rewards ----------
  app.get('/rewards', async (req) => loyaltyOverview(req.account!));

  app.post('/rewards/seen', async (req) => {
    const body = parse(z.object({ ids: z.array(z.number().int().positive()).max(100) }), req.body);
    await markRewardsSeen(req.account!.id, body.ids);
    return { ok: true };
  });

  // Quick header data for the Home screen.
  app.get('/home', async (req) => {
    const u = req.account!;
    const [active] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.userId, u.id), ne(orders.status, 'cancelled'), sql`${orders.status} not in ('delivered','collected')`));
    const [awaiting] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, u.id), eq(orders.status, 'awaiting_payment')))
      .orderBy(desc(orders.id))
      .limit(1);
    const overview = await loyaltyOverview(u);
    return {
      user: publicUser(u),
      balance: overview.balance,
      level: overview.level,
      progress: overview.progress,
      unseen: overview.unseen,
      availableRewards: overview.wallet.filter((w) => w.status === 'available').length,
      activeOrders: active.n,
      awaitingPaymentOrderId: awaiting?.id ?? null,
    };
  });
}
