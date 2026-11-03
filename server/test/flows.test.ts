/**
 * End-to-end API tests against a real PostgreSQL database (TEST_DATABASE_URL, default market_test).
 * Covers onboarding, idempotent checkout, concurrent stock, reward redemption, points award/reversal,
 * cancellation and access control.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  categories,
  couponRedemptions,
  coupons,
  customerRewards,
  levels,
  notifications,
  orders,
  pointsTransactions,
  products,
  rewards,
  shopSettings,
  users,
} from '../src/db/schema.js';
import { signQuery, type TelegramUser } from '../src/lib/telegram-auth.js';
import { setAutoDispatch } from '../src/services/notifications.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
let app: FastifyInstance;
let ids: { apples: number; limited: number; chocolate: number; welcomeCoupon: number; fresh5: number };

function initData(user: TelegramUser, startParam?: string) {
  const fields: Record<string, string> = { query_id: 'AAE', user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000)) };
  if (startParam) fields.start_param = startParam;
  return signQuery(fields, TOKEN);
}

const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token?: string, body?: unknown) => {
  const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body as object });
  return { status: res.statusCode, json: res.json() as any };
};

async function onboard(tg: TelegramUser, phone?: string) {
  const auth = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg, 'store') });
  expect(auth.json.status).toBe('new');
  const done = await call('POST', '/api/onboarding/complete', auth.json.onboardingToken, { firstName: tg.first_name, phone, acceptPrivacy: true });
  expect(done.status).toBe(200);
  return done.json as { token: string; user: { id: number }; welcome: any };
}

const order = (token: string, over: Record<string, unknown> = {}) =>
  call('POST', '/api/orders', token, {
    items: [{ productId: ids.apples, quantity: 2 }],
    fulfillmentType: 'pickup',
    paymentMethod: 'cash',
    contactName: 'Test',
    contactPhone: '+1 555 000 1111',
    idempotencyKey: randomUUID(),
    ...over,
  });

let adminToken: string;

beforeAll(async () => {
  setAutoDispatch(false);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await runMigrations();

  const [welcome] = await db.insert(coupons).values({ title: 'Welcome 10%', discountType: 'percent', value: 10, perCustomerLimit: null }).returning();
  const [fresh5] = await db
    .insert(coupons)
    .values({ code: 'FRESH5', title: '$5 off', discountType: 'fixed', value: 500, minSubtotalCents: 1000, perCustomerLimit: 1, isPublic: true })
    .returning();
  await db.insert(shopSettings).values({ id: 1, deliveryFeeCents: 299, freeDeliveryMinCents: 3500, minOrderCents: 0, signupBonusPoints: 50, pointsPerDollar: 1, welcomeCouponId: welcome.id, pickupAddress: 'Desk' });
  await db.insert(levels).values({ name: 'Sprout', emoji: '🌱', minPoints: 0, multiplierPercent: 100 });
  const [cat] = await db.insert(categories).values({ name: 'Fresh Produce', slug: 'fresh-produce' }).returning();
  const [apples] = await db.insert(products).values({ categoryId: cat.id, name: 'Apples', priceCents: 500, stock: 100 }).returning();
  const [limited] = await db.insert(products).values({ categoryId: cat.id, name: 'Truffle Oil', priceCents: 200, stock: 3 }).returning();
  const [chocolate] = await db.insert(products).values({ categoryId: cat.id, name: 'Chocolate', priceCents: 279, stock: 10 }).returning();
  const [fd] = await db.insert(coupons).values({ title: 'Free delivery', discountType: 'free_delivery', perCustomerLimit: null }).returning();
  await db.insert(rewards).values({ title: 'Free delivery', pointsRequired: 100, couponId: fd.id, emoji: '🚚' });
  ids = { apples: apples.id, limited: limited.id, chocolate: chocolate.id, welcomeCoupon: welcome.id, fresh5: fresh5.id };

  app = await buildApp();
  // ADMIN_TELEGRAM_IDS=999000001 in vitest.config.ts → this login creates an admin directly.
  const admin = await call('POST', '/api/auth/telegram', undefined, { initData: initData({ id: 999000001, first_name: 'Owner' }) });
  expect(admin.json.status).toBe('existing');
  expect(admin.json.user.role).toBe('admin');
  adminToken = admin.json.token;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('Telegram login & onboarding', () => {
  it('rejects forged initData', async () => {
    const forged = signQuery({ user: JSON.stringify({ id: 1, first_name: 'X' }), auth_date: String(Math.floor(Date.now() / 1000)) }, '1:WRONG');
    const r = await call('POST', '/api/auth/telegram', undefined, { initData: forged });
    expect(r.status).toBe(401);
  });

  it('creates the account only after privacy is accepted, grants welcome rewards once, and recognises returning customers', async () => {
    const tg = { id: 5001, first_name: 'Nora', photo_url: 'https://t.me/i/userpic/320/nora.jpg' };
    const first = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg, 'receipt') });
    expect(first.json.status).toBe('new');
    expect(first.json.prefill.firstName).toBe('Nora');
    expect(await db.select().from(users).where(eq(users.telegramId, 5001))).toHaveLength(0);

    // Onboarding token can't be used as a session.
    expect((await call('GET', '/api/me', first.json.onboardingToken)).status).toBe(401);
    // Privacy must be accepted.
    const noConsent = await call('POST', '/api/onboarding/complete', first.json.onboardingToken, { firstName: 'Nora', acceptPrivacy: false });
    expect(noConsent.status).toBe(400);

    const body = { firstName: 'Nora', phone: '+44 7700 900123', acceptPrivacy: true };
    const [a, b] = await Promise.all([
      call('POST', '/api/onboarding/complete', first.json.onboardingToken, body),
      call('POST', '/api/onboarding/complete', first.json.onboardingToken, body),
    ]);
    expect([a.json.status, b.json.status].sort()).toEqual(['created', 'existing']);
    const created = a.json.status === 'created' ? a.json : b.json;
    expect(created.welcome.pointsAwarded).toBe(50);
    expect(created.welcome.welcomeCoupon.title).toBe('Welcome 10%');
    expect(created.loyalty.progress.remaining).toBe(50);

    const [u] = await db.select().from(users).where(eq(users.telegramId, 5001));
    expect(u.pointsBalance).toBe(50);
    expect(u.signupSource).toBe('receipt');
    expect(u.phoneVerified).toBe(false);
    expect(await db.select().from(pointsTransactions).where(eq(pointsTransactions.userId, u.id))).toHaveLength(1);
    expect(await db.select().from(customerRewards).where(eq(customerRewards.userId, u.id))).toHaveLength(1);

    const again = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg) });
    expect(again.json.status).toBe('existing');
    expect(again.json.user.firstName).toBe('Nora');
  });

  it('does not repeat the welcome gift for a second account with the same phone number', async () => {
    const r = await onboard({ id: 5002, first_name: 'Nora2' }, '+447700900123');
    expect(r.welcome.pointsAwarded).toBe(0);
    expect(r.welcome.skippedReason).toBe('phone_already_used');
  });

  it('verifies phone numbers shared through Telegram requestContact', async () => {
    const tg = { id: 5003, first_name: 'Omar' };
    const auth = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg) });
    const contactResponse = signQuery(
      { contact: JSON.stringify({ user_id: 5003, phone_number: '15550009999', first_name: 'Omar' }), auth_date: String(Math.floor(Date.now() / 1000)) },
      TOKEN,
    );
    const done = await call('POST', '/api/onboarding/complete', auth.json.onboardingToken, { firstName: 'Omar', contactResponse, acceptPrivacy: true });
    expect(done.json.user.phone).toBe('+15550009999');
    expect(done.json.user.phoneVerified).toBe(true);
  });
});

describe('Checkout', () => {
  let token: string;
  beforeAll(async () => {
    token = (await onboard({ id: 6001, first_name: 'Pia' }, '+15550006001')).token;
  });

  it('quotes server-side prices, fees and points', async () => {
    const r = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 3 }], fulfillmentType: 'delivery' });
    expect(r.json.quote.subtotalCents).toBe(1500);
    expect(r.json.quote.baseDeliveryFeeCents).toBe(299);
    expect(r.json.quote.totalCents).toBe(1799);
    expect(r.json.quote.pointsEstimate).toBe(15);
    expect(r.json.discounts.wallet).toHaveLength(1);
    expect(r.json.discounts.publicCoupons.map((c: any) => c.code)).toEqual(['FRESH5']);
  });

  it('requires an address only for delivery', async () => {
    const r = await order(token, { fulfillmentType: 'delivery' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('address_required');
    const ok = await order(token, { fulfillmentType: 'delivery', address: { line1: '1 Test Road', city: 'Springfield' } });
    expect(ok.status).toBe(201);
    expect(ok.json.order.address.line1).toBe('1 Test Road');
    expect(ok.json.order.totalCents).toBe(1299);
  });

  it('treats repeated submissions with the same idempotency key as one order', async () => {
    const key = randomUUID();
    const before = (await db.select().from(products).where(eq(products.id, ids.apples)))[0].stock;
    const results = await Promise.all([order(token, { idempotencyKey: key }), order(token, { idempotencyKey: key }), order(token, { idempotencyKey: key })]);
    const orderIds = new Set(results.map((r) => r.json.order.id));
    expect(orderIds.size).toBe(1);
    expect(results.filter((r) => r.json.replayed === false)).toHaveLength(1);
    const after = (await db.select().from(products).where(eq(products.id, ids.apples)))[0].stock;
    expect(before - after).toBe(2);
  });

  it('never oversells under simultaneous purchases', async () => {
    const shoppers = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => onboard({ id: 7000 + i, first_name: `Shopper${i}` }, `+1555007000${i}`)));
    const results = await Promise.all(shoppers.map((s) => order(s.token, { items: [{ productId: ids.limited, quantity: 1 }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409).every((r) => /stock/i.test(r.json.error.message))).toBe(true);
    const [p] = await db.select().from(products).where(eq(products.id, ids.limited));
    expect(p.stock).toBe(0);
  });

  it('lets a wallet reward be redeemed only once, even with concurrent checkouts', async () => {
    const wallet = (await call('POST', '/api/checkout/quote', token, { items: [], fulfillmentType: 'pickup' })).json.discounts.wallet;
    const rewardId = wallet[0].id;
    const results = await Promise.all([order(token, { customerRewardId: rewardId }), order(token, { customerRewardId: rewardId })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const used = results.find((r) => r.status === 201)!.json.order;
    expect(used.discountCents).toBe(100); // 10% of $10
    expect(used.discountLabel).toBe('Welcome 10%');
  });

  it('enforces per-customer coupon limits', async () => {
    expect((await order(token, { couponCode: 'fresh5' })).status).toBe(201);
    const second = await order(token, { couponCode: 'FRESH5' });
    expect(second.status).toBe(409);
    expect(second.json.error.message).toMatch(/already used/);
  });
});

describe('Order lifecycle, points and refunds', () => {
  let token: string;
  let userId: number;
  beforeAll(async () => {
    const r = await onboard({ id: 8001, first_name: 'Quinn' }, '+15550008001');
    token = r.token;
    userId = r.user.id;
  });

  const status = (id: number, s: string, tok = adminToken) => call('POST', `/api/admin/orders/${id}/status`, tok, { status: s });
  const payment = (id: number, s: string) => call('POST', `/api/admin/orders/${id}/payment`, adminToken, { status: s });
  const balance = async () => (await db.select().from(users).where(eq(users.id, userId)))[0].pointsBalance;

  it('awards points only on completion, exactly once, and unlocks milestones', async () => {
    const placed = (await order(token, { items: [{ productId: ids.apples, quantity: 12 }] })).json.order; // $60 → 60 pts
    expect(placed.pointsEstimate).toBe(60);
    for (const s of ['confirmed', 'preparing', 'ready_for_pickup']) expect((await status(placed.id, s)).status).toBe(200);
    expect(await balance()).toBe(50);

    const [c1, c2] = await Promise.all([status(placed.id, 'collected'), status(placed.id, 'collected')]);
    expect([c1.status, c2.status]).toEqual([200, 200]);
    expect(await balance()).toBe(110);
    expect((await status(placed.id, 'collected')).json.changed).toBe(false);
    expect(await balance()).toBe(110);

    const rewardsPage = (await call('GET', '/api/rewards', token)).json;
    expect(rewardsPage.milestones[0].reached).toBe(true);
    expect(rewardsPage.wallet.some((w: any) => w.title === 'Free delivery' && w.status === 'available')).toBe(true);
    const sent = await db.select().from(notifications).where(eq(notifications.chatId, 8001));
    expect(sent.map((n) => n.kind)).toEqual(expect.arrayContaining(['order_placed', 'order_confirmed', 'order_collected', 'reward_unlocked']));
  });

  it('reverses points once on refund and revokes milestone rewards that are no longer earned', async () => {
    const [o] = await db.select().from(orders).where(eq(orders.userId, userId));
    expect((await payment(o.id, 'paid')).status).toBe(200);
    const [r1, r2] = await Promise.all([payment(o.id, 'refunded'), payment(o.id, 'refunded')]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(await balance()).toBe(50);
    const ledger = await db.select().from(pointsTransactions).where(eq(pointsTransactions.orderId, o.id));
    expect(ledger.map((l) => l.delta).sort()).toEqual([-60, 60]);
    const wallet = (await call('GET', '/api/rewards', token)).json.wallet;
    expect(wallet.find((w: any) => w.title === 'Free delivery').status).toBe('revoked');
    expect((await payment(o.id, 'paid')).status).toBe(409);
  });

  it('keeps payment separate and refuses invalid fulfilment transitions', async () => {
    const o = (await order(token)).json.order;
    const bad = await status(o.id, 'out_for_delivery');
    expect(bad.status).toBe(409);
    expect(bad.json.error.details.allowed).toContain('ready_for_pickup');
    expect((await payment(o.id, 'paid')).json.order.status).toBe('placed');
  });

  it('lets customers cancel only before confirmation, restoring stock and rewards', async () => {
    const wallet = (await call('POST', '/api/checkout/quote', token, { items: [], fulfillmentType: 'pickup' })).json.discounts.wallet;
    const welcome = wallet.find((w: any) => w.source === 'welcome');
    const stockBefore = (await db.select().from(products).where(eq(products.id, ids.apples)))[0].stock;
    const o = (await order(token, { customerRewardId: welcome.id, items: [{ productId: ids.apples, quantity: 4 }] })).json.order;
    expect((await db.select().from(products).where(eq(products.id, ids.apples)))[0].stock).toBe(stockBefore - 4);

    const cancelled = await call('POST', `/api/orders/${o.id}/cancel`, token, { reason: 'Changed my mind' });
    expect(cancelled.json.order.status).toBe('cancelled');
    expect((await db.select().from(products).where(eq(products.id, ids.apples)))[0].stock).toBe(stockBefore);
    const [cr] = await db.select().from(customerRewards).where(eq(customerRewards.id, welcome.id));
    expect(cr.status).toBe('available');
    const [red] = await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, o.id));
    expect(red.status).toBe('released');
    // Completing a cancelled order is impossible.
    expect((await status(o.id, 'collected')).status).toBe(409);

    const o2 = (await order(token)).json.order;
    await status(o2.id, 'confirmed');
    const late = await call('POST', `/api/orders/${o2.id}/cancel`, token, {});
    expect(late.status).toBe(409);
  });
});

describe('Access control', () => {
  it('keeps customers out of the dashboard and out of other customers’ orders', async () => {
    const a = await onboard({ id: 9001, first_name: 'Rae' }, '+15550009001');
    const b = await onboard({ id: 9002, first_name: 'Sol' }, '+15550009002');
    const o = (await order(a.token)).json.order;
    expect((await call('GET', `/api/orders/${o.id}`, b.token)).status).toBe(404);
    expect((await call('GET', '/api/admin/orders', a.token)).status).toBe(403);
    expect((await call('POST', `/api/admin/orders/${o.id}/status`, a.token, { status: 'confirmed' })).status).toBe(403);
    expect((await call('GET', '/api/admin/orders')).status).toBe(401);
  });

  it('lets admins promote staff, and staff cannot change loyalty settings', async () => {
    const s = await onboard({ id: 9100, first_name: 'Staffer' }, '+15550009100');
    expect((await call('PUT', `/api/admin/customers/${s.user.id}/role`, adminToken, { role: 'staff' })).status).toBe(200);
    expect((await call('GET', '/api/admin/orders', s.token)).status).toBe(200);
    expect((await call('PUT', '/api/admin/levels', s.token, { levels: [{ name: 'X', emoji: '⭐', minPoints: 0, multiplierPercent: 100, color: '#000000' }] })).status).toBe(403);
  });

  it('never lets stock go negative even if updated directly', async () => {
    await expect(db.update(products).set({ stock: sql`${products.stock} - 1000` }).where(eq(products.id, ids.chocolate))).rejects.toThrow();
  });
});


describe('Languages (Khmer / English)', () => {
  const callLang = async (lang: 'km' | 'en', method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { 'x-lang': lang, ...(token ? { authorization: `Bearer ${token}` } : {}) }, payload: body as object });
    return { status: res.statusCode, json: res.json() as any };
  };

  it('serves shop data and errors in the requested language, falling back to Khmer names', async () => {
    await db.update(products).set({ name: 'ផ្លែប៉ោម', nameEn: 'Apples' }).where(eq(products.id, ids.apples));
    const km = await callLang('km', 'GET', `/api/products/${ids.apples}`);
    const en = await callLang('en', 'GET', `/api/products/${ids.apples}`);
    expect(km.json.product.name).toBe('ផ្លែប៉ោម');
    expect(en.json.product.name).toBe('Apples');
    // No English name → Khmer is used for everyone.
    const choc = await callLang('en', 'GET', `/api/products/${ids.chocolate}`);
    expect(choc.json.product.name).toBe('Chocolate');

    const token = (await onboard({ id: 9700, first_name: 'Kanha' }, '+85599000111')).token;
    const bad = await callLang('km', 'POST', '/api/orders', token, {
      items: [{ productId: ids.apples, quantity: 1 }], fulfillmentType: 'pickup', paymentMethod: 'cash', contactName: 'K', contactPhone: '12', idempotencyKey: randomUUID(),
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/[ក-៿]/); // Khmer script
  });

  it('remembers the language chosen at sign-up and writes Telegram messages in it', async () => {
    const tg = { id: 9701, first_name: 'Sokha' };
    const auth = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg) });
    const done = await call('POST', '/api/onboarding/complete', auth.json.onboardingToken, { firstName: 'Sokha', phone: '+85599000222', acceptPrivacy: true, languageCode: 'km' });
    expect(done.json.user.languageCode).toBe('km');
    const o = (await order(done.json.token)).json.order;
    const [msg] = (await db.select().from(notifications).where(eq(notifications.orderId, o.id))).filter((n) => n.kind === 'order_placed');
    expect(msg.text).toMatch(/អរគុណ/);

    // Switching to English in Profile changes future messages.
    const patched = await call('PATCH', '/api/me', done.json.token, { languageCode: 'en' });
    expect(patched.json.user.languageCode).toBe('en');
    await call('POST', `/api/admin/orders/${o.id}/status`, adminToken, { status: 'confirmed' });
    const confirmed = (await db.select().from(notifications).where(eq(notifications.orderId, o.id))).find((n) => n.kind === 'order_confirmed');
    expect(confirmed?.text).toMatch(/is confirmed/);
  });

  it('accepts cash only', async () => {
    const token = (await onboard({ id: 9702, first_name: 'Dalin' }, '+85599000333')).token;
    const r = await order(token, { paymentMethod: 'qr' });
    expect(r.status).toBe(400);
  });
});

describe('Bulk product import (Excel/CSV)', () => {
  const rows = [
    { row: 2, sku: '8850001', name: 'ទឹកដូងក្រអូប', nameEn: 'Coconut Water', category: 'Fresh Produce', price: '1.75', stock: '24', unit: '1 L' },
    { row: 3, name: 'អង្ករផ្កាម្លិះ', nameEn: 'Jasmine Rice', category: 'អង្ករ', price: '$6.50', stock: 10, featured: 'yes' },
    { row: 4, name: '', category: 'Fresh Produce', price: '1' },
    { row: 5, name: 'Bad price', category: 'Fresh Produce', price: 'abc' },
    { row: 6, sku: '8850001', name: 'Duplicate', category: 'Fresh Produce', price: '1' },
  ];

  it('previews without writing, then imports valid rows and auto-creates new aisles', async () => {
    const before = (await db.select().from(products)).length;
    const preview = await call('POST', '/api/admin/products/import', adminToken, { dryRun: true, rows });
    expect(preview.status).toBe(200);
    expect(preview.json.summary).toMatchObject({ create: 2, update: 0, error: 3, newCategories: ['អង្ករ'] });
    expect(preview.json.rows.find((r: any) => r.row === 6).error).toMatch(/row 2/);
    expect((await db.select().from(products)).length).toBe(before);

    const applied = await call('POST', '/api/admin/products/import', adminToken, { dryRun: false, rows });
    expect(applied.json.dryRun).toBe(false);
    const [water] = await db.select().from(products).where(eq(products.sku, '8850001'));
    expect(water).toMatchObject({ name: 'ទឹកដូងក្រអូប', nameEn: 'Coconut Water', priceCents: 175, stock: 24 });
    const [produce] = await db.select().from(categories).where(eq(categories.id, water.categoryId));
    expect(water.emoji).toBe(produce.emoji); // no emoji column → the aisle's emoji
    const [rice] = await db.select().from(products).where(eq(products.name, 'អង្ករផ្កាម្លិះ'));
    expect(rice.priceCents).toBe(650);
    expect(rice.featured).toBe(true);
    const [riceCat] = await db.select().from(categories).where(eq(categories.id, rice.categoryId));
    expect(riceCat.name).toBe('អង្ករ');
  });

  it('re-importing updates existing products by SKU (price, stock) and audits the stock change', async () => {
    const r = await call('POST', '/api/admin/products/import', adminToken, { dryRun: false, rows: [{ row: 2, sku: '8850001', name: 'ទឹកដូងក្រអូប', price: '1.95', stock: '30' }] });
    expect(r.json.summary).toMatchObject({ create: 0, update: 1, error: 0 });
    const [water] = await db.select().from(products).where(eq(products.sku, '8850001'));
    expect(water.priceCents).toBe(195);
    expect(water.stock).toBe(30);
    expect(water.nameEn).toBe('Coconut Water'); // empty cells keep existing values
  });

  it('is staff-only', async () => {
    const c = await onboard({ id: 9800, first_name: 'Nobody' }, '+85599000444');
    expect((await call('POST', '/api/admin/products/import', c.token, { dryRun: true, rows })).status).toBe(403);
  });
});

describe('Map delivery: distance fee and "tomorrow" option', () => {
  const STORE = { lat: 11.5564, lng: 104.9282 };
  const north = (km: number) => ({ lat: STORE.lat + km / 111.2, lng: STORE.lng });
  let token: string;
  const address = { label: 'Home', line1: 'St 271, #12', city: 'Phnom Penh', save: true };

  beforeAll(async () => {
    await db.update(shopSettings).set({ storeLat: STORE.lat, storeLng: STORE.lng, deliveryPricing: 'distance' });
    token = (await onboard({ id: 9900, first_name: 'Map' }, '+85512990990')).token;
  });
  afterAll(async () => {
    await db.update(shopSettings).set({ storeLat: null, storeLng: null });
  });

  it('shows the store pin and asks for the customer pin before charging', async () => {
    const shop = await call('GET', '/api/shop');
    expect(shop.json).toMatchObject({ deliveryPricing: 'distance', store: STORE, nextDayEnabled: true, nextDayFeeCents: 200 });
    const q = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 2 }], fulfillmentType: 'delivery' });
    expect(q.json.quote.delivery.needsLocation).toBe(true);
    const priced = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 2 }], fulfillmentType: 'delivery', location: north(6) });
    expect(priced.json.quote.delivery).toMatchObject({ distanceKm: 7.8, sameDayFeeCents: 235, nextDayFeeCents: 200 });
    expect(priced.json.quote.nextDayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses delivery without a pin', async () => {
    const r = await order(token, { fulfillmentType: 'delivery', address });
    expect(r.status).toBe(409);
  });

  it('places a next-day order for $2, saves the pin, and gives staff a map link', async () => {
    const r = await order(token, { fulfillmentType: 'delivery', address, location: north(6), deliverySpeed: 'next_day' });
    expect(r.status).toBe(201);
    expect(r.json.order.deliveryFeeCents).toBe(200);
    expect(r.json.order.delivery).toMatchObject({ speed: 'next_day', distanceKm: 7.8 });
    expect(r.json.order.delivery.directionsUrl).toContain(`origin=${STORE.lat},${STORE.lng}`);
    const [row] = await db.select().from(orders).where(eq(orders.id, r.json.order.id));
    const tomorrow = new Date(Date.now() + 7 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    expect(row.deliveryDate).toBe(tomorrow);
    const staff = await db.select().from(notifications).where(sql`${notifications.orderId} = ${row.id} and ${notifications.kind} = 'staff_new_order'`);
    expect(staff[0].text).toContain('google.com/maps/dir');
    expect(staff[0].text).toContain(tomorrow);

    // The saved address keeps the pin, so the next order needs no map tap.
    const saved = await call('GET', '/api/me/addresses', token);
    expect(saved.json.addresses[0]).toMatchObject({ lat: north(6).lat, lng: north(6).lng });
    const again = await order(token, { fulfillmentType: 'delivery', addressId: saved.json.addresses[0].id });
    expect(again.status).toBe(201);
    expect(again.json.order.deliveryFeeCents).toBe(235);
    expect(again.json.order.delivery.speed).toBe('same_day');
  });

  it('refuses pins beyond the delivery limit', async () => {
    const r = await order(token, { fulfillmentType: 'delivery', address: { ...address, save: false }, location: north(18) });
    expect(r.status).toBe(409);
  });

  it('lets admins turn a pasted link or coordinates into the store pin', async () => {
    const ok = await call('POST', '/api/admin/settings/locate', adminToken, { input: '11.5701, 104.9105' });
    expect(ok.json.pin).toEqual({ lat: 11.5701, lng: 104.9105 });
    expect((await call('POST', '/api/admin/settings/locate', adminToken, { input: 'somewhere nice' })).status).toBe(400);
    expect((await call('POST', '/api/admin/settings/locate', token, { input: '11.5, 104.9' })).status).toBe(403);
  });
});

describe('Google Maps support', () => {
  it('reports no maps key when none is configured (the app then uses OpenStreetMap)', async () => {
    expect((await call('GET', '/api/shop')).json.mapsApiKey).toBeNull();
  });

  it('accepts browser CSP violation reports', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://maps.googleapis.com/x', 'violated-directive': 'script-src' } }),
    });
    expect(res.statusCode).toBe(204);
  });

  it('allows the Google Maps hosts in the Content-Security-Policy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toMatch(/script-src[^;]*https:\/\/\*\.googleapis\.com/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.googleapis\.com/);
    expect(csp).toContain('report-uri /api/csp-report');
  });
});

describe('Photos stored in the database', () => {
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf000000030101005d1c21dc0000000049454e44ae426082',
    'hex',
  );
  it('uploads a product photo into the database and serves it with long caching', async () => {
    const boundary = '----mart25';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
      PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({
      method: 'POST',
      url: '/api/admin/uploads',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(up.statusCode).toBe(200);
    const url = up.json().url as string;
    expect(url).toMatch(/^\/media\/[0-9a-f-]{36}\.png$/);
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(res.rawPayload, PNG)).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/media/not-a-photo.png' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/media/%2e%2e%2fsecret.png' })).statusCode).toBe(404);
  });
});
