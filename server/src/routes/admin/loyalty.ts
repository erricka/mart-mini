import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { coupons, levels, products, rewards, shopSettings } from '../../db/schema.js';
import { badRequest, isUniqueViolation, notFound } from '../../lib/errors.js';
import { tr } from '../../lib/i18n.js';
import { idParam, parse } from '../../lib/validate.js';
import { makeGuards } from '../../plugins/auth.js';
import { describeCoupon } from '../../services/loyalty.js';
import { getLevels, getSettings } from '../../services/settings.js';

const settingsInput = z.object({
  shopName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120),
  taglineEn: z.string().trim().max(120).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'err.currency'),
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
    if (b.discountType === 'percent' && (b.value < 1 || b.value > 100)) ctx.addIssue({ code: 'custom', message: 'err.percent' });
    if (b.discountType === 'fixed' && b.value < 1) ctx.addIssue({ code: 'custom', message: 'err.fixed_amount' });
    if (b.discountType === 'free_product' && !b.freeProductId) ctx.addIssue({ code: 'custom', message: 'err.gift_required' });
  });

const couponInput = benefitInput.and(
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,30}$/, 'err.code_format')
      .nullable()
      .optional(),
    title: z.string().trim().min(1).max(80),
    titleEn: z.string().trim().max(80).nullable().optional(),
    description: z.string().trim().max(300).default(''),
    descriptionEn: z.string().trim().max(300).nullable().optional(),
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
  titleEn: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(300).default(''),
  descriptionEn: z.string().trim().max(300).nullable().optional(),
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
        nameEn: z.string().trim().max(40).nullable().optional(),
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
    if (!body.deliveryEnabled && !body.pickupEnabled) throw badRequest('no_fulfillment', tr('err.no_fulfillment'));
    if (body.welcomeCouponId) {
      const [c] = await db.select({ id: coupons.id }).from(coupons).where(eq(coupons.id, body.welcomeCouponId));
      if (!c) throw badRequest('bad_coupon', tr('err.welcome_coupon'));
    }
    await getSettings();
    const [s] = await db.update(shopSettings).set({ ...body, taglineEn: body.taglineEn || null, updatedAt: new Date() }).where(eq(shopSettings.id, 1)).returning();
    return { settings: s };
  });

  app.put('/levels', { preHandler: guard.admin }, async (req) => {
    const body = parse(levelsInput, req.body);
    const sorted = [...body.levels].sort((a, b) => a.minPoints - b.minPoints);
    if (sorted[0].minPoints !== 0) throw badRequest('base_level', tr('err.base_level'));
    if (new Set(sorted.map((l) => l.minPoints)).size !== sorted.length) throw badRequest('dup_level', tr('err.dup_level'));
    await db.transaction(async (tx) => {
      await tx.delete(levels);
      await tx.insert(levels).values(sorted.map((l) => ({ ...l, nameEn: l.nameEn || null })));
    });
    return { levels: await getLevels() };
  });

  async function assertGift(freeProductId?: number | null) {
    if (!freeProductId) return;
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, freeProductId));
    if (!p) throw badRequest('bad_gift', tr('err.gift_not_found'));
  }

  app.post('/rewards', { preHandler: guard.admin }, async (req, reply) => {
    const body = parse(rewardInput, req.body);
    await assertGift(body.benefit.freeProductId);
    const reward = await db.transaction(async (tx) => {
      const [coupon] = await tx
        .insert(coupons)
        .values({
          title: body.title,
          titleEn: body.titleEn || null,
          description: body.description,
          descriptionEn: body.descriptionEn || null,
          ...body.benefit,
          freeProductId: body.benefit.discountType === 'free_product' ? body.benefit.freeProductId : null,
          code: null,
          isPublic: false,
          perCustomerLimit: null,
        })
        .returning();
      const [r] = await tx
        .insert(rewards)
        .values({ title: body.title, titleEn: body.titleEn || null, description: body.description, descriptionEn: body.descriptionEn || null, emoji: body.emoji, pointsRequired: body.pointsRequired, isSurprise: body.isSurprise, active: body.active, couponId: coupon.id })
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
        .set({ title: body.title, titleEn: body.titleEn || null, description: body.description, descriptionEn: body.descriptionEn || null, emoji: body.emoji, pointsRequired: body.pointsRequired, isSurprise: body.isSurprise, active: body.active })
        .where(eq(rewards.id, id))
        .returning();
      if (!r) throw notFound(tr('err.reward_missing'));
      await tx
        .update(coupons)
        .set({
          title: body.title,
          titleEn: body.titleEn || null,
          description: body.description,
          descriptionEn: body.descriptionEn || null,
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
    if (body.isPublic && !body.code) throw badRequest('code_required', tr('err.code_required'));
    if (body.startsAt && body.endsAt && body.endsAt <= body.startsAt) throw badRequest('bad_dates', tr('err.bad_dates'));
    await assertGift(body.freeProductId);
    const values = {
      ...body,
      titleEn: body.titleEn || null,
      descriptionEn: body.descriptionEn || null,
      code: body.code || null,
      freeProductId: body.discountType === 'free_product' ? body.freeProductId : null,
      perCustomerLimit: body.perCustomerLimit ?? null,
      updatedAt: new Date(),
    };
    try {
      if (id == null) return (await db.insert(coupons).values(values).returning())[0];
      const [c] = await db.update(coupons).set(values).where(eq(coupons.id, id)).returning();
      if (!c) throw notFound(tr('err.coupon_missing'));
      return c;
    } catch (err) {
      if (isUniqueViolation(err)) throw badRequest('code_taken', tr('err.code_taken'));
      throw err;
    }
  }

  app.post('/coupons', { preHandler: guard.admin }, async (req, reply) => reply.status(201).send({ coupon: await saveCoupon(null, req.body) }));
  app.put('/coupons/:id', { preHandler: guard.admin }, async (req) => {
    const { id } = parse(idParam, req.params);
    const linked = await db.select({ id: rewards.id }).from(rewards).where(inArray(rewards.couponId, [id]));
    if (linked.length) throw badRequest('reward_coupon', tr('err.reward_coupon'));
    return { coupon: await saveCoupon(id, req.body) };
  });
}
