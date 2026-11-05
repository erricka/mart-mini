import { and, asc, desc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { categories, products, type Product } from '../db/schema.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { pick, tr } from '../lib/i18n.js';
import { TelegramAuthError, validateInitData, type TelegramUser } from '../lib/telegram-auth.js';
import { limit } from '../lib/rate-limit.js';
import { idParam, parse } from '../lib/validate.js';
import { makeGuards, signOnboarding, signSession } from '../plugins/auth.js';
import { completeOnboarding, consumeStaffLoginToken, publicUser, resolveTelegramIdentity } from '../services/identity.js';
import { loyaltyOverview, loyaltyTeaser } from '../services/loyalty.js';
import { getSettings } from '../services/settings.js';

export function publicProduct(p: Product) {
  const onSale = p.compareAtCents != null && p.compareAtCents > p.priceCents;
  return {
    id: p.id,
    categoryId: p.categoryId,
    name: pick(p.name, p.nameEn),
    description: pick(p.description, p.descriptionEn),
    unit: p.unit,
    priceCents: p.priceCents,
    compareAtCents: onSale ? p.compareAtCents : null,
    discountPercent: onSale ? Math.round((1 - p.priceCents / p.compareAtCents!) * 100) : 0,
    stock: Math.max(0, p.stock),
    inStock: p.active && p.stock > 0,
    emoji: p.emoji,
    imageUrl: p.imageUrl,
    featured: p.featured,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function publicRoutes(app: FastifyInstance) {
  const guard = makeGuards(app);
  const authLimit = limit(60);

  async function identityResponse(tg: TelegramUser, startParam: string | null) {
    const result = await resolveTelegramIdentity(tg, startParam);
    if (result.status === 'existing') {
      return { status: 'existing' as const, token: signSession(app, result.user), user: publicUser(result.user) };
    }
    const id = result.identity;
    return {
      status: 'new' as const,
      onboardingToken: signOnboarding(app, id),
      prefill: { firstName: id.firstName, lastName: id.lastName, photoUrl: id.photoUrl, username: id.username },
      startParam: id.startParam,
    };
  }

  // 1) Telegram Mini App login — initData is verified with the bot token (HMAC-SHA256).
  app.post('/auth/telegram', { config: authLimit }, async (req) => {
    const body = parse(z.object({ initData: z.string().min(1).max(8192) }), req.body);
    if (!config.telegramConfigured) {
      throw badRequest('telegram_not_configured', tr('err.tg_not_configured'));
    }
    try {
      const data = validateInitData(body.initData, config.TELEGRAM_BOT_TOKEN, config.INITDATA_MAX_AGE_SECONDS);
      return await identityResponse(data.user, data.startParam);
    } catch (err) {
      if (err instanceof TelegramAuthError) {
        req.log.warn({ reason: err.message }, 'Rejected Telegram initData');
        throw unauthorized(tr('err.tg_verify'));
      }
      throw err;
    }
  });

  // DEV ONLY: lets you use the app in a normal browser. Disabled when NODE_ENV=production.
  app.post('/auth/dev', { config: authLimit }, async (req) => {
    if (!config.devLoginEnabled) throw notFound();
    const body = parse(
      z.object({
        as: z.enum(['customer', 'admin', 'new']),
        source: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional().nullable(),
      }),
      req.body,
    );
    const presets: Record<string, TelegramUser> = {
      customer: { id: 100000001, first_name: 'Sophea', last_name: 'Chan', username: 'sophea_dev' },
      admin: { id: 100000009, first_name: 'Dara', last_name: 'Sok', username: 'dara_mart25' },
    };
    const tg: TelegramUser =
      body.as === 'new'
        ? { id: 200000000 + Math.floor(Math.random() * 99_999_999), first_name: 'Vanna', last_name: 'Lim', username: 'vanna_new' }
        : presets[body.as];
    return identityResponse(tg, body.source ?? null);
  });

  // Browser login for staff via a one-time link sent by the bot (/dashboard).
  app.post('/auth/staff-link', { config: authLimit }, async (req) => {
    const body = parse(z.object({ token: z.string().min(20).max(200) }), req.body);
    const user = await consumeStaffLoginToken(body.token);
    return { status: 'existing', token: signSession(app, user), user: publicUser(user) };
  });

  // 2) First-time onboarding: confirm name, optional phone, accept privacy → account + membership.
  app.post('/onboarding/complete', { preHandler: guard.onboarding, config: authLimit }, async (req) => {
    const body = parse(
      z.object({
        firstName: z.string().trim().min(1, 'err.name_required').max(64),
        lastName: z.string().trim().max(64).optional().nullable(),
        phone: z.string().trim().max(30).optional().nullable(),
        contactResponse: z.string().max(8192).optional().nullable(),
        acceptPrivacy: z.boolean(),
        languageCode: z.enum(['km', 'en']).optional().nullable(),
      }),
      req.body,
    );
    const result = await completeOnboarding(req.onboarding!, body);
    const overview = await loyaltyOverview(result.user);
    return {
      status: result.created ? 'created' : 'existing',
      token: signSession(app, result.user),
      user: publicUser(result.user),
      welcome: result.welcome,
      loyalty: {
        balance: overview.balance,
        level: overview.level,
        progress: overview.progress,
        wallet: overview.wallet.filter((w) => w.status === 'available'),
      },
    };
  });

  // ---------- Shop & catalog (public) ----------
  app.get('/shop', async () => {
    const s = await getSettings();
    return {
      shopName: s.shopName,
      tagline: pick(s.tagline, s.taglineEn),
      currency: s.currency,
      deliveryEnabled: s.deliveryEnabled,
      pickupEnabled: s.pickupEnabled,
      deliveryFeeCents: s.deliveryFeeCents,
      freeDeliveryMinCents: s.freeDeliveryMinCents,
      // Distance pricing: the store pin is public (it's the shop), so the map can centre on it.
      deliveryPricing: s.deliveryPricing === 'distance' && s.storeLat != null && s.storeLng != null ? 'distance' : 'flat',
      store: s.storeLat != null && s.storeLng != null ? { lat: s.storeLat, lng: s.storeLng } : null,
      deliveryMinFeeCents: s.deliveryMinFeeCents,
      deliveryMaxKm: s.deliveryMaxKm,
      nextDayEnabled: s.nextDayEnabled,
      nextDayFeeCents: s.nextDayFeeCents,
      // Browser key (restricted to this site in Google Cloud). Null → OpenStreetMap without address auto-fill.
      mapsApiKey: config.GOOGLE_MAPS_API_KEY || null,
      minOrderCents: s.minOrderCents,
      pickupAddress: s.pickupAddress,
      pickupHours: s.pickupHours,
      supportPhone: s.supportPhone,
      devLoginEnabled: config.devLoginEnabled,
      telegramConfigured: config.telegramConfigured,
      notificationsSimulated: config.simulateNotifications,
      loyalty: await loyaltyTeaser(),
    };
  });

  app.get('/categories', async () => {
    const rows = await db
      .select({
        id: categories.id,
        name: categories.name,
        nameEn: categories.nameEn,
        slug: categories.slug,
        emoji: categories.emoji,
        color: categories.color,
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = ${categories.id} and p.active)`,
      })
      .from(categories)
      .where(eq(categories.active, true))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return { categories: rows.map(({ nameEn, ...c }) => ({ ...c, name: pick(c.name, nameEn) })) };
  });

  app.get('/products', async (req) => {
    const q = parse(
      z.object({
        categoryId: z.coerce.number().int().positive().optional(),
        q: z.string().trim().max(80).optional(),
        promo: z.coerce.boolean().optional(),
        featured: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(100),
      }),
      req.query,
    );
    const where: SQL[] = [eq(products.active, true), sql`exists (select 1 from categories c where c.id = ${products.categoryId} and c.active)`];
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(or(ilike(products.name, like), ilike(products.description, like), ilike(products.tags, like))!);
    }
    if (q.promo) where.push(sql`${products.compareAtCents} > ${products.priceCents}`);
    if (q.featured) where.push(eq(products.featured, true));
    const rows = await db
      .select()
      .from(products)
      .where(and(...where))
      .orderBy(desc(gt(products.stock, 0)), sql`(select c.sort_order from categories c where c.id = "products"."category_id")`, asc(products.name))
      .limit(q.limit);
    return { products: rows.map(publicProduct) };
  });

  app.get('/products/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const [p] = await db.select().from(products).where(and(eq(products.id, id), eq(products.active, true)));
    if (!p) throw notFound(tr('err.product_gone'));
    const [category] = await db.select().from(categories).where(eq(categories.id, p.categoryId));
    return {
      product: publicProduct(p),
      category: category ? { id: category.id, name: pick(category.name, category.nameEn), emoji: category.emoji, color: category.color } : null,
    };
  });
}
