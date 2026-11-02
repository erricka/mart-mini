import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, type Executor, type Tx } from '../db/client.js';
import {
  couponRedemptions,
  coupons,
  customerRewards,
  orderItems,
  orders,
  pointsTransactions,
  products,
  categories,
  rewards,
  users,
  type Coupon,
  type ShopSettings,
  type User,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { formatMoney } from '../lib/format.js';
import { pick, tr, userLang, type Lang } from '../lib/i18n.js';
import { esc, queueNotification } from './notifications.js';
import { getLevels, getSettings, levelFor, localLevel } from './settings.js';

type PointsType = (typeof pointsTransactions.$inferInsert)['type'];

export async function lockUser(tx: Tx, userId: number): Promise<User> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!u) throw notFound('Customer not found.');
  return u;
}

/**
 * Applies a points change exactly once per idempotency key (unique index on the ledger).
 * Locks the user row so balances stay consistent under concurrency.
 */
export async function applyPoints(
  tx: Tx,
  args: {
    userId: number;
    delta: number;
    type: PointsType;
    idempotencyKey: string;
    orderId?: number | null;
    note?: string | null;
    actorUserId?: number | null;
  },
): Promise<{ applied: boolean; balance: number }> {
  const user = await lockUser(tx, args.userId);
  const balanceAfter = user.pointsBalance + args.delta;
  const inserted = await tx
    .insert(pointsTransactions)
    .values({
      userId: args.userId,
      delta: args.delta,
      balanceAfter,
      type: args.type,
      orderId: args.orderId ?? null,
      idempotencyKey: args.idempotencyKey,
      note: args.note ?? null,
      actorUserId: args.actorUserId ?? null,
    })
    .onConflictDoNothing({ target: pointsTransactions.idempotencyKey })
    .returning({ id: pointsTransactions.id });
  if (inserted.length === 0) return { applied: false, balance: user.pointsBalance };
  await tx.update(users).set({ pointsBalance: balanceAfter, updatedAt: new Date() }).where(eq(users.id, args.userId));
  return { applied: true, balance: balanceAfter };
}

export function rewardExpiry(settings: ShopSettings, from = new Date()) {
  return settings.rewardExpiryDays ? new Date(from.getTime() + settings.rewardExpiryDays * 86_400_000) : null;
}

/**
 * Makes the customer's milestone rewards match their balance:
 * unlocks every active milestone at or below the balance (once per customer, enforced by a unique
 * index) and revokes still-unused milestone rewards whose threshold is no longer met (e.g. after a refund).
 */
export async function syncMilestones(
  tx: Tx,
  user: Pick<User, 'id' | 'telegramId'> & { languageCode?: string | null },
  balance: number,
  opts: { notify?: boolean; settings?: ShopSettings } = {},
) {
  const settings = opts.settings ?? (await getSettings(tx));
  const allRewards = await tx.select().from(rewards).orderBy(asc(rewards.pointsRequired));
  const owned = await tx
    .select()
    .from(customerRewards)
    .where(and(eq(customerRewards.userId, user.id), eq(customerRewards.source, 'milestone')));
  const ownedByReward = new Map(owned.map((o) => [o.rewardId, o]));
  const now = new Date();
  const unlocked: { title: string; titleEn: string | null; emoji: string }[] = [];

  for (const r of allRewards) {
    const existing = ownedByReward.get(r.id);
    if (r.active && r.pointsRequired <= balance) {
      if (!existing) {
        const ins = await tx
          .insert(customerRewards)
          .values({ userId: user.id, rewardId: r.id, couponId: r.couponId, source: 'milestone', expiresAt: rewardExpiry(settings) })
          .onConflictDoNothing()
          .returning({ id: customerRewards.id });
        if (ins.length) unlocked.push({ title: r.title, titleEn: r.titleEn, emoji: r.emoji });
      } else if (existing.status === 'revoked') {
        await tx
          .update(customerRewards)
          .set({ status: 'available', revokedAt: null, unlockedAt: now, seenAt: null, expiresAt: rewardExpiry(settings) })
          .where(and(eq(customerRewards.id, existing.id), eq(customerRewards.status, 'revoked')));
        unlocked.push({ title: r.title, titleEn: r.titleEn, emoji: r.emoji });
      }
    } else if (existing && existing.status === 'available' && r.pointsRequired > balance) {
      await tx
        .update(customerRewards)
        .set({ status: 'revoked', revokedAt: now })
        .where(and(eq(customerRewards.id, existing.id), eq(customerRewards.status, 'available')));
    }
  }

  if (opts.notify) {
    const lang = userLang(user);
    for (const u of unlocked) {
      await queueNotification(tx, {
        userId: user.id,
        chatId: user.telegramId,
        kind: 'reward_unlocked',
        text: tr('n.reward_unlocked', { emoji: u.emoji, title: esc(pick(u.title, u.titleEn, lang)) }, lang),
        buttonText: tr('n.btn_rewards', {}, lang),
        buttonPath: '/rewards',
      });
    }
  }
  return unlocked;
}

// ---------- Customer-facing overview ----------

export function describeCoupon(c: Coupon, currency: string, giftName?: string | null, lang?: Lang) {
  switch (c.discountType) {
    case 'percent':
      return c.maxDiscountCents
        ? tr('c.percent_cap', { n: c.value, max: formatMoney(c.maxDiscountCents, currency, lang) }, lang)
        : tr('c.percent', { n: c.value }, lang);
    case 'fixed':
      return tr('c.fixed', { amount: formatMoney(c.value, currency, lang) }, lang);
    case 'free_delivery':
      return tr('c.free_delivery', {}, lang);
    case 'free_product':
      return tr('c.free_product', { name: giftName ?? tr('c.gift', {}, lang) }, lang);
  }
}

export function serializeCoupon(c: Coupon, currency: string, giftName?: string | null) {
  return {
    id: c.id,
    code: c.code,
    title: pick(c.title, c.titleEn),
    description: pick(c.description, c.descriptionEn),
    discountType: c.discountType,
    value: c.value,
    benefit: describeCoupon(c, currency, giftName),
    minSubtotalCents: c.minSubtotalCents,
    endsAt: c.endsAt,
  };
}

/** Wallet items (personal rewards) + public coupons the customer can currently use. */
export async function availableDiscounts(userId: number, ex: Executor = db) {
  const settings = await getSettings(ex);
  const now = new Date();
  const wallet = await ex
    .select({ cr: customerRewards, coupon: coupons, reward: rewards, giftName: products.name, giftNameEn: products.nameEn })
    .from(customerRewards)
    .innerJoin(coupons, eq(coupons.id, customerRewards.couponId))
    .leftJoin(rewards, eq(rewards.id, customerRewards.rewardId))
    .leftJoin(products, eq(products.id, coupons.freeProductId))
    .where(eq(customerRewards.userId, userId))
    .orderBy(desc(customerRewards.unlockedAt));

  const publicCoupons = await ex
    .select({ coupon: coupons, giftName: products.name, giftNameEn: products.nameEn })
    .from(coupons)
    .leftJoin(products, eq(products.id, coupons.freeProductId))
    .where(
      and(
        eq(coupons.isPublic, true),
        eq(coupons.active, true),
        sql`${coupons.code} IS NOT NULL`,
        or(isNull(coupons.startsAt), sql`${coupons.startsAt} <= now()`),
        or(isNull(coupons.endsAt), sql`${coupons.endsAt} > now()`),
        or(isNull(coupons.maxRedemptions), sql`${coupons.redeemedCount} < ${coupons.maxRedemptions}`),
      ),
    );

  const usedCounts = publicCoupons.length
    ? await ex
        .select({ couponId: couponRedemptions.couponId, n: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .where(
          and(
            eq(couponRedemptions.userId, userId),
            eq(couponRedemptions.status, 'active'),
            inArray(
              couponRedemptions.couponId,
              publicCoupons.map((p) => p.coupon.id),
            ),
          ),
        )
        .groupBy(couponRedemptions.couponId)
    : [];
  const usedBy = new Map(usedCounts.map((u) => [u.couponId, u.n]));

  const items = wallet.map(({ cr, coupon, reward, giftName: g, giftNameEn }) => {
    const giftName = g ? pick(g, giftNameEn) : g;
    const expired = cr.status === 'available' && cr.expiresAt != null && cr.expiresAt < now;
    return {
      id: cr.id,
      source: cr.source,
      status: expired ? ('expired' as const) : cr.status,
      title: reward ? pick(reward.title, reward.titleEn) : pick(coupon.title, coupon.titleEn),
      emoji: reward?.emoji ?? (cr.source === 'welcome' ? '👋' : '🎟️'),
      unlockedAt: cr.unlockedAt,
      usedAt: cr.usedAt,
      orderId: cr.orderId,
      expiresAt: cr.expiresAt,
      seen: cr.seenAt != null,
      coupon: serializeCoupon(coupon, settings.currency, giftName),
    };
  });

  return {
    wallet: items,
    publicCoupons: publicCoupons
      .filter((p) => p.coupon.perCustomerLimit == null || (usedBy.get(p.coupon.id) ?? 0) < p.coupon.perCustomerLimit)
      .map((p) => serializeCoupon(p.coupon, settings.currency, p.giftName ? pick(p.giftName, p.giftNameEn) : null)),
  };
}

const BADGES = [
  { id: 'member', emoji: '🌱' },
  { id: 'first_basket', emoji: '🧺' },
  { id: 'regular', emoji: '🔁' },
  { id: 'big_basket', emoji: '🛒' },
  { id: 'fresh_fan', emoji: '🥬' },
  { id: 'explorer', emoji: '🧭' },
] as const;

async function computeBadges(userId: number, ex: Executor) {
  const completed = sql`${orders.status} IN ('delivered','collected') AND ${orders.paymentStatus} <> 'refunded'`;
  const [stats] = await ex
    .select({
      completedOrders: sql<number>`count(*)::int`,
      biggest: sql<number>`coalesce(max(${orders.subtotalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.userId, userId), completed));
  const [aisles] = await ex
    .select({
      categoriesBought: sql<number>`count(distinct ${products.categoryId})::int`,
      freshOrders: sql<number>`count(distinct ${orders.id}) filter (where ${categories.slug} = 'fresh-produce')::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(orders.userId, userId), completed, eq(orderItems.isGift, false)));

  const earned: Record<string, boolean> = {
    member: true,
    first_basket: stats.completedOrders >= 1,
    regular: stats.completedOrders >= 5,
    big_basket: stats.biggest >= 5000,
    fresh_fan: (aisles?.freshOrders ?? 0) >= 3,
    explorer: (aisles?.categoriesBought ?? 0) >= 5,
  };
  const currency = (await getSettings(ex)).currency;
  return {
    badges: BADGES.map((b) => ({
      ...b,
      title: tr(`badge.${b.id}`),
      hint: tr(`badge.${b.id}_hint`, { amount: formatMoney(5000, currency) }),
      earned: earned[b.id],
    })),
    completedOrders: stats.completedOrders,
  };
}

export async function loyaltyOverview(user: User) {
  // Late-added milestones are granted the next time the customer opens Rewards.
  await db.transaction(async (tx) => {
    const fresh = await lockUser(tx, user.id);
    await syncMilestones(tx, fresh, fresh.pointsBalance);
  });

  const [settings, allLevels, fresh] = await Promise.all([
    getSettings(),
    getLevels(),
    db.select().from(users).where(eq(users.id, user.id)).then((r) => r[0]),
  ]);
  const balance = fresh.pointsBalance;
  const { current, next } = levelFor(allLevels, balance);

  const milestoneRows = await db
    .select({ reward: rewards, coupon: coupons, giftName: products.name, giftNameEn: products.nameEn })
    .from(rewards)
    .innerJoin(coupons, eq(coupons.id, rewards.couponId))
    .leftJoin(products, eq(products.id, coupons.freeProductId))
    .where(eq(rewards.active, true))
    .orderBy(asc(rewards.pointsRequired));

  const discounts = await availableDiscounts(user.id);
  const walletByReward = new Map<number, (typeof discounts.wallet)[number]>();
  const walletRows = await db
    .select({ id: customerRewards.id, rewardId: customerRewards.rewardId })
    .from(customerRewards)
    .where(eq(customerRewards.userId, user.id));
  for (const w of walletRows) {
    const item = discounts.wallet.find((d) => d.id === w.id);
    if (w.rewardId && item) walletByReward.set(w.rewardId, item);
  }

  const milestones = milestoneRows.map(({ reward, coupon, giftName: g, giftNameEn }) => {
    const giftName = g ? pick(g, giftNameEn) : g;
    const reached = reward.pointsRequired <= balance;
    const hidden = reward.isSurprise && !reached;
    return {
      id: reward.id,
      title: pick(reward.title, reward.titleEn),
      description: hidden ? tr('rw.mystery_text') : pick(reward.description, reward.descriptionEn),
      emoji: hidden ? '🎁' : reward.emoji,
      pointsRequired: reward.pointsRequired,
      isSurprise: reward.isSurprise,
      reached,
      benefit: hidden ? tr('rw.mystery') : describeCoupon(coupon, settings.currency, giftName),
      walletStatus: walletByReward.get(reward.id)?.status ?? null,
    };
  });

  const nextMilestone = milestones.find((m) => !m.reached) ?? null;
  const prevThreshold = [...milestones].reverse().find((m) => m.reached)?.pointsRequired ?? 0;
  const progress = nextMilestone
    ? {
        title: nextMilestone.title,
        emoji: nextMilestone.emoji,
        pointsRequired: nextMilestone.pointsRequired,
        remaining: nextMilestone.pointsRequired - balance,
        fromPoints: prevThreshold,
        percent: Math.min(
          100,
          Math.max(0, Math.round(((balance - prevThreshold) / Math.max(1, nextMilestone.pointsRequired - prevThreshold)) * 100)),
        ),
      }
    : null;

  const history = await db
    .select()
    .from(pointsTransactions)
    .where(eq(pointsTransactions.userId, user.id))
    .orderBy(desc(pointsTransactions.createdAt), desc(pointsTransactions.id))
    .limit(50);

  const { badges, completedOrders } = await computeBadges(user.id, db);

  return {
    balance,
    pointsPerDollar: settings.pointsPerDollar,
    level: current,
    nextLevel: next ? { ...next, remaining: next.minPoints - balance } : null,
    levels: allLevels.map(localLevel),
    milestones,
    progress,
    wallet: discounts.wallet,
    publicCoupons: discounts.publicCoupons,
    unseen: discounts.wallet.filter((w) => !w.seen && w.status === 'available'),
    history: history.map((h) => ({
      id: h.id,
      delta: h.delta,
      balanceAfter: h.balanceAfter,
      type: h.type,
      orderId: h.orderId,
      note: h.note,
      createdAt: h.createdAt,
    })),
    badges,
    completedOrders,
  };
}

export async function markRewardsSeen(userId: number, ids: number[]) {
  if (!ids.length) return;
  await db
    .update(customerRewards)
    .set({ seenAt: new Date() })
    .where(and(eq(customerRewards.userId, userId), inArray(customerRewards.id, ids), isNull(customerRewards.seenAt)));
}

/** Short teaser used on the welcome screen and after onboarding. */
export async function loyaltyTeaser(ex: Executor = db) {
  const settings = await getSettings(ex);
  const [first] = await ex
    .select({ reward: rewards, coupon: coupons, giftName: products.name, giftNameEn: products.nameEn })
    .from(rewards)
    .innerJoin(coupons, eq(coupons.id, rewards.couponId))
    .leftJoin(products, eq(products.id, coupons.freeProductId))
    .where(and(eq(rewards.active, true), sql`${rewards.pointsRequired} > ${settings.signupBonusPoints}`))
    .orderBy(asc(rewards.pointsRequired))
    .limit(1);
  let welcomeCoupon: ReturnType<typeof serializeCoupon> | null = null;
  if (settings.welcomeCouponId) {
    const [w] = await ex
      .select({ coupon: coupons, giftName: products.name, giftNameEn: products.nameEn })
      .from(coupons)
      .leftJoin(products, eq(products.id, coupons.freeProductId))
      .where(and(eq(coupons.id, settings.welcomeCouponId), eq(coupons.active, true)));
    if (w) welcomeCoupon = serializeCoupon(w.coupon, settings.currency, w.giftName ? pick(w.giftName, w.giftNameEn) : null);
  }
  return {
    signupBonusPoints: settings.signupBonusPoints,
    pointsPerDollar: settings.pointsPerDollar,
    welcomeCoupon,
    firstMilestone: first
      ? {
          title: pick(first.reward.title, first.reward.titleEn),
          emoji: first.reward.isSurprise ? '🎁' : first.reward.emoji,
          pointsRequired: first.reward.pointsRequired,
          benefit: first.reward.isSurprise ? tr('rw.mystery') : describeCoupon(first.coupon, settings.currency, first.giftName ? pick(first.giftName, first.giftNameEn) : null),
        }
      : null,
  };
}
