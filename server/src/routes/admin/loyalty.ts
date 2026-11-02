import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { coupons, levels, products, rewards, shopSettings } from '../../db/schema.js';
import { badRequest, isUniqueViolation, notFound } from '../../lib/errors.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { describeCoupon } from '../../services/loyalty.js';
import { providerStatus } from '../../services/payments.js';
import { getLevels, getSettings } from '../../services/settings.js';

const settingsInput = z.object({
  shopName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code like USD.'),
  deliveryEnabled: z.boolean(),
  pickupEnabled: z.boolean(),
  deliveryFeeCents: z.number().int().min(0).max(100_000),
  freeDeliveryMinCents: z.number().int().min(0).max(10_000_000).nullable(),
  minOrderCents: z.number().int().min(0).max(10_000_000),
  pickupAddress: z.string().trim().max(200),
  pickupHours: z.string().trim().max(120),
  supportPhone: z.string().trim().max(40),
  pointsPerDollar: z.number().int().min(0).max(100),
  signupBonusPoints: z.number().int().min(0).max(10_000),
  welcomeCouponId: z.number().int().positive().nullable(),
  rewardExpiryDays: z.number().int().min(1).max(3650).nullable(),
  cashEnabled: z.boolean(),
  qrPaymentMode: z.enum(['off', 'simulated', 'aba_payway']),
  qrPaymentInstructions: z.string().trim().max(300),
  paymentWindowMinutes: z.number().int().min(5).max(24 * 60),
});

const benefitInput = z
  .object({
    discountType: z.enum(['percent', 'fixed', 'free_delivery', 'free_product']),
    value: z.number().int().min(0).max(10_000_000).default(0),
    freeProductId: z.number().int().positive().nullable().optional(),
    minSubtotalCents: z.number().int().min(0).max(10_000_000).default(0),
    maxDiscountCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.discountType === 'percent' && (b.value < 1 || b.value > 100)) ctx.addIssue({ code: 'custom', message: 'Percent must be 1–100.' });
    if (b.discountType === 'fixed' && b.value < 1) ctx.addIssue({ code: 'custom', message: 'Enter the discount amount.' });
    if (b.discountType === 'free_product' && !b.freeProductId) ctx.addIssue({ code: 'custom', message: 'Choose the gift product.' });
  });

const couponInput = benefitInput.and(
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, 'Codes use 3–30 letters, numbers, - or _.')
      .nullable()
      .optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(''),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    maxRedemptions: z.number().int().min(1).nullable().optional(),
    perCustomerLimit: z.number().int().min(1).nullable().optional(),
    isPublic: z.boolean().default(false),
    active: z.boolean().default(true),
  }),
);

const rewardInput = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(''),
  emoji: z.string().trim().min(1).max(16).default('🎁'),
  pointsRequired: z.number().int().min(1).max(1_000_000),
  isSurprise: z.boolean().default(false),
  active: z.boolean().default(true),
  benefit: benefitInput,
});

const levelsInput = z.object({
  levels: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        emoji: z.string().trim().min(1).max(16),
        minPoints: z.number().int().min(0).max(10_000_000),
        multiplierPercent: z.number().int().min(100).max(500),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .min(1)
    .max(10),
});

export async function adminLoyaltyRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);

  // Read access for all staff; changes are admin-only.
  app.get('/loyalty', { preHandler: guard.staff }, async () => {
    const [settings, lv] = await Promise.all([getSettings(), getLevels()]);
    const rewardRows = await db
      .select({ reward: rewards, coupon: coupons, giftName: products.name })
      .from(rewards)
      .innerJoin(coupons, eq(coupons.id, rewards.couponId))
      .leftJoin(products, eq(products.id, coupons.freeProductId))
      .orderBy(asc(rewards.pointsRequired));
    const rewardCouponIds = new Set(rewardRows.map((r) => r.coupon.id));
    const couponRows = await db
      .select({ coupon: coupons, giftName: products.name })
      .from(coupons)
      .leftJoin(products, eq(products.id, coupons.freeProductId))
      .orderBy(asc(coupons.id));
    const [stats] = await db.execute<{ unlocked: number; used: number }>(sql`
      select count(*)::int as unlocked, count(*) filter (where status = 'used')::int as used from customer_rewards`).then((r) => r.rows);
    return {
      settings,
      paymentProviders: providerStatus(),
      levels: lv,
      rewards: rewardRows.map((r) => ({
        ...r.reward,
        benefit: {
          discountType: r.coupon.discountType,
          value: r.coupon.value,
          freeProductId: r.coupon.freeProductId,
          minSubtotalCents: r.coupon.minSubtotalCents,
          maxDiscountCents: r.coupon.maxDiscountCents,
          label: describeCoupon(r.coupon, settings.currency, r.giftName),
        },
      })),
      coupons: couponRows
        .filter((c) => !rewardCouponIds.has(c.coupon.id))
        .map((c) => ({ ...c.coupon, benefit: describeCoupon(c.coupon, settings.currency, c.giftName), isWelcome: c.coupon.id === settings.welcomeCouponId })),
      stats,
    };
  });

  app.put('/settings', { preHandler: guard.admin }, async (req) => {
    const body = parse(settingsInput, req.body);
    if (!body.deliveryEnabled && !body.pickupEnabled) throw badRequest('no_fulfillment', 'Enable delivery, pickup, or both.');
    if (!body.cashEnabled && body.qrPaymentMode === 'off') throw badRequest('no_payment', 'Enable cash, QR payment, or both.');
    if (body.qrPaymentMode !== 'off' && !providerStatus().find((p) => p.id === body.qrPaymentMode)?.configured) {
      throw badRequest(
        'provider_unavailable',
        body.qrPaymentMode === 'simulated'
          ? 'Simulated payments are disabled on this server (production).'
          : 'ABA PayWay is not connected yet — see server/src/services/providers/aba-payway.ts.',
      );
    }
    if (body.welcomeCouponId) {
      const [c] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, body.welcomeCouponId));
      if (!c) throw badRequest('bad_coupon', 'Welcome coupon not found.');
    }
    await getSettings();
    const [s] = await db.update(shopSettings).set({ ...body, updatedAt: new Date() }).where(eq(shopSettings.id, 1)).returning();
    return { settings: s };
  });

  app.put('/levels', { preHandler: guard.admin }, async (req) => {
    const body = parse(levelsInput, req.body);
    const sorted = [...body.levels].sort((a, b) => a.minPoints - b.minPoints);
    if (sorted[0].minPoints !== 0) throw badRequest('base_level', 'The first level must start at 0 points.');
    if (new Set(sorted.map((l) => l.minPoints)).size !== sorted.length) throw badRequest('dup_level', 'Each level needs a different point threshold.');
    await db.transaction(async (tx) => {
      await tx.delete(levels);
      await tx.insert(levels).values(sorted);
    });
    return { levels: await getLevels() };
  });

  async function assertGift(freeProductId?: number | null) {
    if (!freeProductId) return;
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, freeProductId));
    if (!p) throw badRequest('bad_gift', 'Gift product not found.');
  }

  app.post('/rewards', { preHandler: guard.admin }, async (req, reply) => {
    const body = parse(rewardInput, req.body);
    await assertGift(body.benefit.freeProductId);
    const reward = await db.transaction(async (tx) => {
      const [coupon] = await tx
        .insert(coupons)
        .values({
          title: body.title,
          description: body.description,
          ...body.benefit,
          freeProductId: body.benefit.discountType === 'free_product' ? body.benefit.freeProductId : null,
          code: null,
          isPublic: false,
          perCustomerLimit: null,
        })
        .returning();
      const [r] = await tx
        .insert(rewards)
        .values({ title: body.title, description: body.description, emoji: body.emoji, pointsRequired: body.pointsRequired, isSurprise: body.isSurprise, active: body.active, couponId: coupon.id })
        .returning();
      return r;
    });
    return reply.status(201).send({ reward });
  });

  app.put('/rewards/:id', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(rewardInput, req.body);
    await assertGift(body.benefit.freeProductId);
    const reward = await db.transaction(async (tx) => {
      const [r] = await tx
        .update(rewards)
        .set({ title: body.title, description: body.description, emoji: body.emoji, pointsRequired: body.pointsRequired, isSurprise: body.isSurprise, active: body.active })
        .where(eq(rewards.id, id))
        .returning();
      if (!r) throw notFound('Reward not found.');
      await tx
        .update(coupons)
        .set({
          title: body.title,
          description: body.description,
          ...body.benefit,
          freeProductId: body.benefit.discountType === 'free_product' ? body.benefit.freeProductId : null,
          updatedAt: new Date(),
        })
        .where(eq(coupons.id, r.couponId));
      return r;
    });
    return { reward };
  });

  async function saveCoupon(id: number | null, raw: unknown) {
    const body = parse(couponInput, raw);
    if (body.isPublic && !body.code) throw badRequest('code_required', 'Public coupons need a code customers can enter.');
    if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt) throw badRequest('bad_dates', 'End date must be after the start date.');
    await assertGift(body.freeProductId);
    const values = {
      ...body,
      code: body.code || null,
      freeProductId: body.discountType === 'free_product' ? body.freeProductId : null,
      perCustomerLimit: body.perCustomerLimit ?? null,
      updatedAt: new Date(),
    };
    try {
      if (id == null) return (await db.insert(coupons).values(values).returning())[0];
      const [c] = await db.update(coupons).set(values).where(eq(coupons.id, id)).returning();
      if (!c) throw notFound('Coupon not found.');
      return c;
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest('code_taken', 'Another coupon already uses this code.');
      throw err;
    }
  }

  app.post('/coupons', { preHandler: guard.admin }, async (req, reply) => reply.status(201).send({ coupon: await saveCoupon(null, req.body) }));
  app.put('/coupons/:id', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const linked = await db.select({ id: rewards.id }).from(rewards).where(inArray(rewards.couponId, [id]));
    if (linked.length) throw badRequest('reward_coupon', 'Edit this one from the milestone rewards list.');
    return { coupon: await saveCoupon(id, req.body) };
  });
}
