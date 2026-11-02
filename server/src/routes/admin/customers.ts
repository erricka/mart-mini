import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { addresses, orders, pointsTransactions, users } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { publicUser } from '../../services/identity.js';
import { applyPoints, availableDiscounts, syncMilestones } from '../../services/loyalty.js';
import { esc, kickNotifications, queueNotification } from '../../services/notifications.js';
import { serializeOrderSummary } from '../../services/orders.js';
import { getLevels, levelFor } from '../../services/settings.js';

const completedSql = sql`${orders.status} in ('delivered','collected') and ${orders.paymentStatus} <> 'refunded'`;

export function qrLink(source: string) {
  const bot = config.TELEGRAM_BOT_USERNAME.replace(/^@/, '');
  if (bot && config.TELEGRAM_MINIAPP_SHORT_NAME) return `https://t.me/${bot}/${config.TELEGRAM_MINIAPP_SHORT_NAME}?startapp=${source}`;
  if (bot) return `https://t.me/${bot}?startapp=${source}`; // requires the bot's Main Mini App (BotFather → Bot Settings → Configure Mini App)
  return new URL(`/?src=${source}`, config.PUBLIC_URL).toString(); // dev fallback: opens in a browser
}

export async function adminCustomerRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);

  app.get('/customers', { preHandler: guard.staff }, async (req) => {
    const q = parse(
      z.object({
        q: z.string().trim().max(80).optional(),
        role: z.enum(['customer', 'staff', 'admin']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(or(ilike(users.firstName, like), ilike(users.lastName, like), ilike(users.username, like), ilike(users.phone, like))!);
    }
    if (q.role) where.push(eq(users.role, q.role));
    const rows = await db
      .select({
        user: users,
        orderCount: sql<number>`(select count(*)::int from orders o where o.user_id = ${users.id})`,
        spentCents: sql<number>`(select coalesce(sum(o.total_cents),0)::int from orders o where o.user_id = ${users.id} and o.status in ('delivered','collected') and o.payment_status <> 'refunded')`,
        lastOrderAt: sql<Date | null>`(select max(o.placed_at) from orders o where o.user_id = ${users.id})`,
      })
      .from(users)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    const lv = await getLevels();
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
    return {
      total,
      customers: rows.map((r) => ({
        ...publicUser(r.user),
        signupSource: r.user.signupSource,
        level: levelFor(lv, r.user.pointsBalance).current,
        orderCount: r.orderCount,
        spentCents: r.spentCents,
        lastOrderAt: r.lastOrderAt,
      })),
    };
  });

  app.get('/customers/:id', { preHandler: guard.staff }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound('Customer not found.');
    const [addr, recentOrders, history, discounts, lv, [totals]] = await Promise.all([
      db.select().from(addresses).where(eq(addresses.userId, id)),
      db.select().from(orders).where(eq(orders.userId, id)).orderBy(desc(orders.placedAt)).limit(25),
      db.select().from(pointsTransactions).where(eq(pointsTransactions.userId, id)).orderBy(desc(pointsTransactions.id)).limit(100),
      availableDiscounts(id),
      getLevels(),
      db
        .select({ spentCents: sql<number>`coalesce(sum(${orders.totalCents}),0)::int`, completed: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.userId, id), completedSql)),
    ]);
    return {
      customer: {
        ...publicUser(u),
        signupSource: u.signupSource,
        privacyAcceptedAt: u.privacyAcceptedAt,
        lastSeenAt: u.lastSeenAt,
        level: levelFor(lv, u.pointsBalance).current,
        ...totals,
      },
      addresses: addr,
      orders: recentOrders.map((o) => serializeOrderSummary(o)),
      pointsHistory: history,
      wallet: discounts.wallet,
    };
  });

  /** Manual points adjustment (goodwill, corrections). Admin-only, audited, idempotent. */
  app.post('/customers/:id/points', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        delta: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, 'Enter a non-zero amount.'),
        note: z.string().trim().min(3, 'Please add a reason (shown in the history).').max(200),
        idempotencyKey: z.string().min(8).max(100),
      }),
      req.body,
    );
    const result = await db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!u) throw notFound('Customer not found.');
      if (u.pointsBalance + body.delta < 0) throw badRequest('negative_balance', `This would leave ${u.firstName} with a negative balance.`);
      const r = await applyPoints(tx, {
        userId: id,
        delta: body.delta,
        type: 'manual_adjustment',
        idempotencyKey: `manual:${body.idempotencyKey}`,
        note: body.note,
        actorUserId: req.account!.id,
      });
      if (r.applied) {
        await syncMilestones(tx, u, r.balance, { notify: true });
        if (body.delta > 0) {
          await queueNotification(tx, {
            userId: u.id,
            chatId: u.telegramId,
            kind: 'points_bonus',
            text: `⭐ You received <b>${body.delta} bonus points</b> from the shop!\n${esc(body.note)}`,
            buttonText: 'See my rewards',
            buttonPath: '/rewards',
          });
        }
      }
      return r;
    });
    kickNotifications();
    return result;
  });

  app.put('/customers/:id/role', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ role: z.enum(['customer', 'staff', 'admin']) }), req.body);
    if (id === req.account!.id) throw badRequest('self_role', "You can't change your own role.");
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) throw notFound('Customer not found.');
    if (config.ADMIN_TELEGRAM_IDS.includes(target.telegramId) && body.role !== 'admin') {
      throw badRequest('env_admin', 'This person is an admin via ADMIN_TELEGRAM_IDS. Remove them there first.');
    }
    const [u] = await db.update(users).set({ role: body.role, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    return { customer: publicUser(u) };
  });

  // ---------- QR codes for the store & receipts ----------
  const sourceSchema = z.object({
    source: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use letters, numbers, - or _').default('store'),
    format: z.enum(['svg', 'png']).default('svg'),
  });

  app.get('/qr/links', { preHandler: guard.staff }, async () => {
    const signups = await db
      .select({ source: users.signupSource, n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.role, 'customer'))
      .groupBy(users.signupSource);
    const presets = [
      { source: 'store', label: 'In-store poster', hint: 'Entrance, checkout lanes, shelves' },
      { source: 'receipt', label: 'Printed receipts', hint: 'Add to the receipt footer' },
      { source: 'flyer', label: 'Flyers & bags', hint: 'Leaflets, delivery bags' },
    ];
    return {
      botConfigured: !!config.TELEGRAM_BOT_USERNAME,
      usesShortName: !!config.TELEGRAM_MINIAPP_SHORT_NAME,
      links: presets.map((p) => ({ ...p, url: qrLink(p.source) })),
      signupsBySource: signups.map((s) => ({ source: s.source ?? 'unknown', count: s.n })),
    };
  });

  app.get('/qr', { preHandler: guard.staff }, async (req, reply) => {
    const q = parse(sourceSchema, req.query);
    const url = qrLink(q.source);
    if (q.format === 'png') {
      const png = await QRCode.toBuffer(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
      return reply
        .type('image/png')
        .header('content-disposition', `inline; filename="qr-${q.source}.png"`)
        .send(png);
    }
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14532d', light: '#ffffff' } });
    return reply.type('image/svg+xml').send(svg);
  });
}
