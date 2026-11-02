import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { orderStatusEnum, orders, paymentStatusEnum, users } from '../../db/schema.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { addOrderNote, changeOrderStatus, changePaymentStatus, getOrderDetail, serializeOrderSummary } from '../../services/orders.js';

const ACTIVE = ['placed', 'confirmed', 'preparing', 'out_for_delivery', 'ready_for_pickup'] as const;
const DONE = ['delivered', 'collected'] as const;

export async function adminOrderRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);
  app.addHook('preHandler', guard.staff);

  app.get('/orders', async (req) => {
    const q = parse(
      z.object({
        view: z.enum(['active', 'completed', 'cancelled', 'all']).default('active'),
        status: z.enum(orderStatusEnum.enumValues).optional(),
        q: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.status) where.push(eq(orders.status, q.status));
    else if (q.view === 'active') where.push(inArray(orders.status, [...ACTIVE]));
    else if (q.view === 'completed') where.push(inArray(orders.status, [...DONE]));
    else if (q.view === 'cancelled') where.push(eq(orders.status, 'cancelled'));
    if (q.q) {
      const digits = q.q.replace(/^#/, '');
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const conds: SQL[] = [ilike(orders.contactName, like), ilike(orders.contactPhone, like)];
      if (/^\d+$/.test(digits)) conds.push(eq(orders.id, Number(digits)));
      where.push(or(...conds)!);
    }
    const rows = await db
      .select({
        order: orders,
        username: users.username,
        items: sql<number>`(select coalesce(sum(quantity),0)::int from order_items oi where oi.order_id = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(q.view === 'active' ? sql`${orders.placedAt} asc` : desc(orders.placedAt))
      .limit(q.limit)
      .offset(q.offset);

    const counts = await db
      .select({ status: orders.status, n: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.status, [...ACTIVE]))
      .groupBy(orders.status);

    return {
      orders: rows.map((r) => ({
        ...serializeOrderSummary(r.order, r.items),
        username: r.username,
        city: r.order.city,
        discountLabel: r.order.discountLabel,
        hasNote: !!r.order.customerNote,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    };
  });

  /** Lightweight endpoint the dashboard polls to raise "new order" alerts. */
  app.get('/orders/pulse', async () => {
    const [row] = await db
      .select({
        latestOrderId: sql<number>`coalesce(max(${orders.id}), 0)::int`,
        newCount: sql<number>`count(*) filter (where ${orders.status} = 'placed')::int`,
        activeCount: sql<number>`count(*) filter (where ${orders.status} in ('placed','confirmed','preparing','out_for_delivery','ready_for_pickup'))::int`,

      })
      .from(orders);
    return row;
  });

  app.get('/orders/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return { order: await getOrderDetail(id, { staff: true }) };
  });

  app.post('/orders/:id/status', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        status: z.enum(orderStatusEnum.enumValues),
        note: z.string().trim().max(500).optional().nullable(),
        reason: z.string().trim().max(300).optional().nullable(),
      }),
      req.body,
    );
    const result = await changeOrderStatus({ orderId: id, to: body.status, actor: req.account!, note: body.note, reason: body.reason });
    return { ...result, order: await getOrderDetail(id, { staff: true }) };
  });

  app.post('/orders/:id/payment', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ status: z.enum(paymentStatusEnum.enumValues), note: z.string().trim().max(500).optional().nullable() }),
      req.body,
    );
    const result = await changePaymentStatus({ orderId: id, to: body.status, actor: req.account!, note: body.note });
    return { ...result, order: await getOrderDetail(id, { staff: true }) };
  });

  app.post('/orders/:id/notes', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ note: z.string().trim().min(1).max(1000) }), req.body);
    await addOrderNote(id, req.account!, body.note);
    return { order: await getOrderDetail(id, { staff: true }) };
  });
}
