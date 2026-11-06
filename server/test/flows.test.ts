/**
 * End-to-end API tests against a real PostgreSQL database (TEST_DATABASE_URL, default market_test).
 * Covers onboarding, idempotent checkout, concurrent stock, reward redemption, points award/reversal,
 * cancellation and access control.
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  branches,
  categories,
  couponRedemptions,
  coupons,
  customerRewards,
  inventoryMovements,
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

const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token?: string, body?: unknown) => {
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
    const pending = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 3 }], fulfillmentType: 'delivery' });
    expect(pending.json.quote.baseDeliveryFeeCents).toBeNull(); // no address yet → fee pending, never $0
    expect(pending.json.quote.delivery.status).toBe('needs_address');
    const r = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 3 }], fulfillmentType: 'delivery', addressReady: true });
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
    expect(q.json.quote.delivery).toMatchObject({ status: 'needs_address', freeDelivery: false });
    expect(q.json.quote.baseDeliveryFeeCents).toBeNull();
    const priced = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 2 }], fulfillmentType: 'delivery', location: north(6) });
    expect(priced.json.quote.delivery).toMatchObject({ distanceKm: 7.8, sameDayFeeCents: 235, nextDayFeeCents: 200 });
    expect(priced.json.quote.nextDayDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses delivery without a pin (fee pending)', async () => {
    const r = await order(token, { fulfillmentType: 'delivery', address });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('delivery_needs_address');
  });

  it('validates the fee the customer reviewed before creating the order', async () => {
    // Customer saw a stale fee (e.g. before moving the pin) → refused, nothing created.
    const stale = await order(token, { fulfillmentType: 'delivery', address: { ...address, save: false }, location: north(6), expectedDeliveryFeeCents: 75 });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('price_changed');
    expect(stale.json.error.details).toMatchObject({ deliveryFeeCents: 235 });
    // The free-delivery threshold can't be claimed by the client: $10 basket < $35 rule.
    const fakeFree = await order(token, { fulfillmentType: 'delivery', address: { ...address, save: false }, location: north(6), expectedDeliveryFeeCents: 0 });
    expect(fakeFree.json.error.code).toBe('price_changed');
    const ok = await order(token, {
      fulfillmentType: 'delivery',
      address: { ...address, save: false },
      location: north(6),
      expectedDeliveryFeeCents: 235,
      expectedTotalCents: 1000 + 235,
    });
    expect(ok.status).toBe(201);
    expect(ok.json.order.deliveryFeeCents).toBe(235);
  });

  it('free delivery at exactly the threshold, standard fee again just below it', async () => {
    // Test shop rule: free delivery from $35.00 of items (apples are $5).
    const at = await order(token, { fulfillmentType: 'delivery', address: { ...address, save: false }, location: north(6), items: [{ productId: ids.apples, quantity: 7 }], expectedDeliveryFeeCents: 0 });
    expect(at.status).toBe(201);
    expect(at.json.order.deliveryFeeCents).toBe(0);
    const below = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 6 }], fulfillmentType: 'delivery', location: north(6) });
    expect(below.json.quote.baseDeliveryFeeCents).toBe(235);
    expect(below.json.quote.delivery.freeRule).toMatchObject({ remainingCents: 500, met: false });
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

  it('delivers anywhere by default: a far pin gets a distance fee, not a refusal', async () => {
    const [s] = await db.select().from(shopSettings);
    expect(s.deliveryMaxKm).toBeNull(); // mart25 default: no distance limit
    const q = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 2 }], fulfillmentType: 'delivery', location: north(18) });
    expect(q.json.quote.delivery).toMatchObject({ status: 'ok', distanceKm: 23.4 });
    expect(q.json.quote.baseDeliveryFeeCents).toBe(625); // 0.38 + 0.25 × 23.4 km, rounded up to 5¢
  });

  it('refuses pins beyond a delivery limit when the shop sets one', async () => {
    await db.update(shopSettings).set({ deliveryMaxKm: 20 });
    const r = await order(token, { fulfillmentType: 'delivery', address: { ...address, save: false }, location: north(18), items: [{ productId: ids.apples, quantity: 10 }] });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('delivery_unsupported');
    const q = await call('POST', '/api/checkout/quote', token, { items: [{ productId: ids.apples, quantity: 10 }], fulfillmentType: 'delivery', location: north(18) });
    expect(q.json.quote.baseDeliveryFeeCents).toBeNull(); // never $0, even above the free-delivery threshold
    expect(q.json.quote.delivery.freeDelivery).toBe(false);
    await db.update(shopSettings).set({ deliveryMaxKm: null });
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

describe('Google Maps budget (keeps Google free)', () => {
  it('allows Google maps / look-ups up to the daily and monthly limits, then says no', async () => {
    const { allowMapsUse } = await import('../src/services/mapsBudget.js');
    const day = new Date('2026-03-10T20:00:00Z');
    const limits = { daily: 3, monthly: 5 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allowMapsUse('geocode', limits, day));
    expect(results).toEqual([true, true, true, false]); // daily cap
    const nextDay = new Date('2026-03-11T20:00:00Z');
    expect(await allowMapsUse('geocode', limits, nextDay)).toBe(true);
    expect(await allowMapsUse('geocode', limits, nextDay)).toBe(true);
    expect(await allowMapsUse('geocode', limits, nextDay)).toBe(false); // monthly cap (5)
    expect(await allowMapsUse('map', limits, nextDay)).toBe(true); // counted separately
    expect(await allowMapsUse('geocode', limits, new Date('2026-04-02T20:00:00Z'))).toBe(true); // new month
  });

  it('is available to signed-in users only', async () => {
    expect((await call('POST', '/api/maps/allow', undefined, { kind: 'map' })).status).toBe(401);
    const ok = await call('POST', '/api/maps/allow', adminToken, { kind: 'map' });
    expect(ok.status).toBe(200);
    expect(typeof ok.json.allowed).toBe('boolean');
  });
});

describe('Removing a customer (admin)', () => {
  const tg = { id: 9950, first_name: 'Rina', last_name: 'Ly', username: 'rina_ly' };
  let token: string;
  let userId: number;
  let orderId: number;

  beforeAll(async () => {
    const r = await onboard(tg, '+855 12 995 000');
    token = r.token;
    userId = r.user.id;
    await call('POST', '/api/me/addresses', token, { label: 'Home', line1: 'St 63, #8', city: 'Phnom Penh', lat: 11.55, lng: 104.92 });
    const o = await order(token, { fulfillmentType: 'pickup', note: 'call me on arrival' });
    orderId = o.json.order.id;
  });

  it('is refused while an order is in progress, for staff accounts, and for non-admins', async () => {
    const busy = await call('DELETE', `/api/admin/customers/${userId}`, adminToken);
    expect(busy.status).toBe(409);
    expect(busy.json.error.code).toBe('active_orders');
    expect((await call('DELETE', `/api/admin/customers/${userId}`, token)).status).toBe(403); // a customer can't
    const staff = await onboard({ id: 9951, first_name: 'Staffy' }, '+855 12 995 001');
    await db.update(users).set({ role: 'staff' }).where(eq(users.id, staff.user.id));
    expect((await call('DELETE', `/api/admin/customers/${staff.user.id}`, staff.token)).status).toBe(403); // staff can't remove
    expect((await call('DELETE', `/api/admin/customers/${staff.user.id}`, adminToken)).json.error.code).toBe('remove_staff');
  });

  it('wipes personal data, keeps the order anonymised, signs them out and hides them', async () => {
    await call('POST', `/api/admin/orders/${orderId}/status`, adminToken, { status: 'cancelled', reason: 'test' });
    const r = await call('DELETE', `/api/admin/customers/${userId}`, adminToken);
    expect(r.status).toBe(200);

    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ lastName: null, username: null, photoUrl: null, phone: null, pointsBalance: 0 });
    expect(u.deletedAt).not.toBeNull();
    expect(u.firstName).not.toBe('Rina');
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(o.contactPhone).toBe('—');
    expect(o.customerNote).toBeNull();
    expect(o.totalCents).toBeGreaterThan(0); // the shop's record of the sale stays
    expect(await db.select().from(sql`addresses`).where(sql`user_id = ${userId}`)).toHaveLength(0);

    expect((await call('GET', '/api/me', token)).status).toBe(401); // signed out immediately
    const list = await call('GET', '/api/admin/customers?q=Rina', adminToken);
    expect(list.json.customers).toHaveLength(0);
    expect((await call('GET', `/api/admin/customers/${userId}`, adminToken)).status).toBe(404);
  });

  it('a removed person can sign up again — but gets no second welcome gift', async () => {
    const auth = await call('POST', '/api/auth/telegram', undefined, { initData: initData(tg, 'store') });
    expect(auth.json.status).toBe('new'); // onboarding again
    const done = await call('POST', '/api/onboarding/complete', auth.json.onboardingToken, { firstName: 'Rina', acceptPrivacy: true });
    expect(done.status).toBe(200);
    expect(done.json.user.id).toBe(userId); // same account, restored
    expect(done.json.welcome).toBeNull();
    expect(done.json.user.pointsBalance).toBe(0);
  });
});

describe('Importing a POS product export', () => {
  // Shaped like the mart25 POS "Product List" export: Code (Barcode empty), Name, Price, Stock Qty. (all 0), Product Group.
  const pos = [
    { row: 7, code: '8934868197911', sku: null, name: 'សាប៊ូទឹក Viso', price: 3.125, stock: 0, category: 'សាប៊ូ' },
    { row: 8, code: '8851932471015', sku: null, name: 'សាប៊ូទឹក Viso', price: 3.125, stock: 0, category: 'សាប៊ូ' },
    { row: 9, code: 'P0000095', sku: null, name: 'ធុងជូត ព្រៀបស', price: 21, stock: 0, category: 'ធុងជូត' },
    { row: 10, code: 'P0000096', sku: null, name: 'កៅអីផ្លាស្ទិក', price: 4, stock: 0, category: null },
  ];
  const importPos = (rows: object[], dryRun = false) => call('POST', '/api/admin/products/import', adminToken, { dryRun, stockMode: 'keep', startStock: 25, rows });

  it('keeps same-name variants apart, rounds riel-style prices, defaults the category and spots stock-less files', async () => {
    const preview = await call('POST', '/api/admin/products/import', adminToken, { dryRun: true, stockMode: 'keep', startStock: 25, rows: pos });
    expect(preview.status).toBe(200);
    expect(preview.json.summary).toMatchObject({ create: 4, update: 0, error: 0, roundedPrices: 2, defaultCategoryCount: 1, fileHasStock: false });
    expect(preview.json.summary.sharedNames).toMatchObject({ count: 2, examples: ['សាប៊ូទឹក Viso'] });
    expect(preview.json.rows.every((r: any) => r.stock === 25)).toBe(true);

    const applied = await call('POST', '/api/admin/products/import', adminToken, { dryRun: false, stockMode: 'keep', startStock: 25, rows: pos });
    expect(applied.json.summary.create).toBe(4);
    const viso = await db.select().from(products).where(eq(products.name, 'សាប៊ូទឹក Viso'));
    expect(viso.map((p) => p.sku).sort()).toEqual(['8851932471015', '8934868197911']); // two products, not one overwritten
    expect(viso.every((p) => p.priceCents === 313 && p.stock === 25)).toBe(true);
    const [chair] = await db.select().from(products).where(eq(products.sku, 'P0000096'));
    const [other] = await db.select().from(categories).where(eq(categories.id, chair.categoryId));
    expect(other).toMatchObject({ name: 'ផ្សេងៗ', nameEn: 'Other' });
  });

  it('uploading the same file again adds nothing and writes nothing', async () => {
    const before = await db.select().from(products);
    const moves = (await db.select().from(inventoryMovements)).length;
    const preview = await importPos(pos, true);
    expect(preview.json.summary).toMatchObject({ create: 0, update: 0, same: 4, error: 0, roundedPrices: 0, newCategories: [] });
    expect(preview.json.rows.every((r: any) => r.action === 'same')).toBe(true);
    const r = await importPos(pos);
    expect(r.json.summary).toMatchObject({ create: 0, update: 0, same: 4 });
    const after = await db.select().from(products);
    expect(after.length).toBe(before.length);
    const stamp = (ps: typeof before) => ps.map((p) => `${p.id}:${p.updatedAt.toISOString()}`).sort();
    expect(stamp(after)).toEqual(stamp(before)); // not even touched
    expect((await db.select().from(inventoryMovements)).length).toBe(moves);
  });

  it('a newer export adds only new products, updates only what changed, and leaves stock alone in keep mode', async () => {
    const [before] = await db.select().from(products).where(eq(products.sku, 'P0000095'));
    await db.update(products).set({ stock: 7 }).where(eq(products.id, before.id)); // sold some in the shop
    const newer = [
      ...pos.map((r) => (r.code === 'P0000095' ? { ...r, price: 22.5 } : r)),
      { row: 11, code: 'P0000097', sku: null, name: 'កន្ត្រកផ្លាស្ទិក', price: 2, stock: 0, category: 'ធុងជូត' },
    ];
    const preview = await importPos(newer, true);
    expect(preview.json.summary).toMatchObject({ create: 1, update: 1, same: 3 });
    expect(preview.json.rows.find((r: any) => r.row === 9)).toMatchObject({ action: 'update', changes: ['priceCents'], oldPriceCents: 2100, priceCents: 2250 });
    const r = await importPos(newer);
    expect(r.json.summary).toMatchObject({ create: 1, update: 1, same: 3 });
    const [after] = await db.select().from(products).where(eq(products.sku, 'P0000095'));
    expect(after.priceCents).toBe(2250);
    expect(after.stock).toBe(7); // the POS file's 0 did not wipe the shop's stock
    expect((await db.select().from(products).where(eq(products.sku, 'P0000097'))).length).toBe(1);
  });

  it('recognises a product by its code or its barcode — a barcode added later never makes a duplicate', async () => {
    const count = (await db.select().from(products)).length;
    // Next export: the Barcode column is now filled for P0000096 (the code stays the same).
    const r = await importPos([{ row: 10, code: 'P0000096', sku: '8859999000096', name: 'កៅអីផ្លាស្ទិក', price: 4, stock: 0, category: null }]);
    expect(r.json.summary).toMatchObject({ create: 0, error: 0 });
    // And a file that only has the barcode for a product stored under that barcode-as-code.
    const r2 = await importPos([{ row: 2, code: null, sku: '8934868197911', name: 'សាប៊ូទឹក Viso', price: 3.125, stock: 0, category: 'សាប៊ូ' }]);
    expect(r2.json.summary).toMatchObject({ create: 0, same: 1 });
    expect((await db.select().from(products)).length).toBe(count);
    const [chair] = await db.select().from(products).where(eq(products.name, 'កៅអីផ្លាស្ទិក'));
    expect(chair.sku).toBe('P0000096'); // the shop's SKU stays the same, so the next upload finds it again
  });

  it('the same product twice in one file (by code or barcode) is reported, not added twice', async () => {
    const r = await importPos(
      [
        { row: 2, code: 'P0000200', sku: null, name: 'ផលិតផល A', price: 1, category: 'ធុងជូត' },
        { row: 3, code: 'X1', sku: 'P0000200', name: 'ផលិតផល A', price: 1, category: 'ធុងជូត' },
      ],
      true,
    );
    expect(r.json.summary).toMatchObject({ create: 1, error: 1 });
    expect(r.json.rows.find((x: any) => x.row === 3).error).toMatch(/2/);
  });

  it('attaches a POS code to a hand-made product with the same unique name, but never guesses between variants', async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const [manual] = await db.insert(products).values({ categoryId: cat.id, name: 'ទឹកសុទ្ធ Vital', priceCents: 50, stock: 12 }).returning();
    const r = await call('POST', '/api/admin/products/import', adminToken, {
      dryRun: false,
      rows: [{ row: 2, sku: '8850000999001', name: 'ទឹកសុទ្ធ Vital', price: 0.5, stock: 40, category: cat.name }],
    });
    expect(r.json.summary).toMatchObject({ create: 0, update: 1 });
    const [linked] = await db.select().from(products).where(eq(products.id, manual.id));
    expect(linked).toMatchObject({ sku: '8850000999001', stock: 40 });
  });
});

describe('Product photos', () => {
  const photo = '/media/0b6a3f0e-6c11-4f43-9a51-6e8b3c2a9d10.jpg';
  let catId: number;
  beforeAll(async () => {
    [{ id: catId }] = await db.select({ id: categories.id }).from(categories).limit(1);
  });

  it('saves a product whose photo was uploaded to the shop (regression: /media links were refused)', async () => {
    const created = await call('POST', '/api/admin/products', adminToken, { categoryId: catId, name: 'រូបថតតេស្ត', priceCents: 100, imageUrl: photo, stock: 3 });
    expect(created.status).toBe(201);
    const edited = await call('PUT', `/api/admin/products/${created.json.product.id}`, adminToken, { categoryId: catId, name: 'រូបថតតេស្ត 2', priceCents: 120, imageUrl: photo });
    expect(edited.status).toBe(200);
    expect(edited.json.product.imageUrl).toBe(photo);
  });

  it('matches photos to products by code or exact name, keeps existing photos, then assigns', async () => {
    await db.insert(products).values([
      { categoryId: catId, name: 'ឆ្នាំងដាំបាយ', sku: 'PHOTO-001', priceCents: 900, stock: 2 },
      { categoryId: catId, name: 'ប៉ោងភ្លើង', priceCents: 300, stock: 2 },
      { categoryId: catId, name: 'កែវទឹក', sku: 'PHOTO-003', priceCents: 100, stock: 2, imageUrl: 'https://example.com/old.jpg' },
    ]);
    const items = [{ key: 'photo-001' }, { key: 'ប៉ោងភ្លើង' }, { key: 'PHOTO-003' }, { key: 'nothing-like-this' }];
    const dry = await call('POST', '/api/admin/products/photos', adminToken, { dryRun: true, items });
    expect(dry.json.results.map((r: any) => r.status)).toEqual(['matched', 'matched', 'kept', 'none']);
    const url2 = '/media/1b6a3f0e-6c11-4f43-9a51-6e8b3c2a9d11.jpg';
    const done = await call('POST', '/api/admin/products/photos', adminToken, {
      dryRun: false,
      items: [{ key: 'photo-001', url: photo }, { key: 'ប៉ោងភ្លើង', url: url2 }, { key: 'PHOTO-003', url: photo }],
    });
    expect(done.json.matched).toBe(2);
    const [rice] = await db.select().from(products).where(eq(products.sku, 'PHOTO-001'));
    expect(rice.imageUrl).toBe(photo);
    const [glass] = await db.select().from(products).where(eq(products.sku, 'PHOTO-003'));
    expect(glass.imageUrl).toBe('https://example.com/old.jpg'); // kept: replace was off
  });

  it('sets one product photo quickly and lists products still without a photo', async () => {
    const before = await call('GET', '/api/admin/products?photo=missing', adminToken);
    const target = before.json.products[0];
    expect(target.imageUrl).toBeNull();
    expect(before.json.summary.noPhoto).toBeGreaterThan(0);
    const r = await call('PUT', `/api/admin/products/${target.id}/photo`, adminToken, { imageUrl: photo });
    expect(r.status).toBe(200);
    const after = await call('GET', '/api/admin/products?photo=missing', adminToken);
    expect(after.json.products.some((p: any) => p.id === target.id)).toBe(false);
    expect((await call('PUT', `/api/admin/products/${target.id}/photo`, adminToken, { imageUrl: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('POS import adds photos to products without one, never silently replaces a photo', async () => {
    const r = await call('POST', '/api/admin/products/import', adminToken, {
      dryRun: false,
      rows: [{ row: 7, sku: 'PHOTO-003', name: 'កែវទឹក', price: 1, imageUrl: photo }],
    });
    expect(r.json.summary).toMatchObject({ update: 0, same: 1 }); // photo kept → nothing to change
    const [glass] = await db.select().from(products).where(eq(products.sku, 'PHOTO-003'));
    expect(glass.imageUrl).toBe('https://example.com/old.jpg');
    const rep = await call('POST', '/api/admin/products/import', adminToken, { dryRun: false, replacePhotos: true, rows: [{ row: 7, sku: 'PHOTO-003', name: 'កែវទឹក', price: 1, imageUrl: photo }] });
    expect(rep.json.rows[0]).toMatchObject({ action: 'update', changes: ['imageUrl'] });
    const [replaced] = await db.select().from(products).where(eq(products.sku, 'PHOTO-003'));
    expect(replaced.imageUrl).toBe(photo);
  });
});

describe('Dashboard counts', () => {
  it('shows the real number of products per category and orders per customer', async () => {
    const cats = await call('GET', '/api/admin/categories', adminToken);
    for (const c of cats.json.categories) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.categoryId, c.id));
      expect(c.productCount).toBe(n);
    }
    const customers = await call('GET', '/api/admin/customers', adminToken);
    const list = customers.json.customers ?? customers.json.rows;
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.userId, c.id));
      expect(c.orderCount).toBe(n);
    }
  });
});

describe('Deleting products and categories', () => {
  const newProduct = async (categoryId: number, name: string, over: Partial<typeof products.$inferInsert> = {}) =>
    (await db.insert(products).values({ categoryId, name, priceCents: 300, stock: 20, ...over }).returning())[0];

  it('is admin-only', async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const p = await newProduct(cat.id, 'Staff cannot delete me');
    const staff = await onboard({ id: 9810, first_name: 'Staffer' }, '+85599000810');
    await db.update(users).set({ role: 'staff' }).where(eq(users.id, staff.user.id));
    expect((await call('DELETE', `/api/admin/products/${p.id}`, staff.token)).status).toBe(403);
    expect((await call('POST', '/api/admin/products/delete', staff.token, { ids: [p.id] })).status).toBe(403);
    expect((await call('DELETE', `/api/admin/categories/${cat.id}`, staff.token)).status).toBe(403);
    expect((await db.select().from(products).where(eq(products.id, p.id))).length).toBe(1);
  });

  it('removes a product for good while past orders keep their lines, and cancelling such an order still works', async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const p = await newProduct(cat.id, 'Old soap');
    const c = await onboard({ id: 9811, first_name: 'Buyer' }, '+85599000811');
    const placed = await order(c.token, { items: [{ productId: p.id, quantity: 2 }] });
    expect(placed.status).toBe(201);
    const orderId = placed.json.order.id;

    const del = await call('DELETE', `/api/admin/products/${p.id}`, adminToken);
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ deleted: 1 });
    expect((await db.select().from(products).where(eq(products.id, p.id))).length).toBe(0);
    expect((await db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, p.id))).length).toBe(0);

    const detail = await call('GET', `/api/orders/${orderId}`, c.token);
    expect(detail.json.order.items[0]).toMatchObject({ name: 'Old soap', quantity: 2, productId: null });
    const cancelled = await call('POST', `/api/orders/${orderId}/cancel`, c.token, { reason: 'test' });
    expect(cancelled.json.order.status).toBe('cancelled');
    expect((await call('DELETE', `/api/admin/products/${p.id}`, adminToken)).status).toBe(404);
  });

  it('deletes many at once and switches off a coupon whose free gift was deleted', async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const a = await newProduct(cat.id, 'Bulk A');
    const b = await newProduct(cat.id, 'Bulk B');
    const [gift] = await db.insert(coupons).values({ title: 'Free Bulk A', discountType: 'free_product', freeProductId: a.id, perCustomerLimit: null }).returning();
    const r = await call('POST', '/api/admin/products/delete', adminToken, { ids: [a.id, b.id, a.id] });
    expect(r.json).toMatchObject({ deleted: 2, couponsDisabled: 1 });
    const [after] = await db.select().from(coupons).where(eq(coupons.id, gift.id));
    expect(after).toMatchObject({ active: false, freeProductId: null });
  });

  it('never empties a category by surprise: asks first, then deletes the category with its products', async () => {
    const [cat] = await db.insert(categories).values({ name: 'Frozen', slug: 'frozen-test' }).returning();
    await newProduct(cat.id, 'Ice cream');
    await newProduct(cat.id, 'Frozen peas');
    const ask = await call('DELETE', `/api/admin/categories/${cat.id}`, adminToken);
    expect(ask.status).toBe(409);
    expect(ask.json.error).toMatchObject({ code: 'category_has_products', details: { products: 2 } });
    const ok = await call('DELETE', `/api/admin/categories/${cat.id}?withProducts=true`, adminToken);
    expect(ok.json).toMatchObject({ deleted: 2, category: 'Frozen' });
    expect((await db.select().from(categories).where(eq(categories.id, cat.id))).length).toBe(0);
    const [empty] = await db.insert(categories).values({ name: 'Empty', slug: 'empty-test' }).returning();
    expect((await call('DELETE', `/api/admin/categories/${empty.id}`, adminToken)).json).toMatchObject({ deleted: 0 });
  });

  it('finds products added today, yesterday or this week', async () => {
    const [cat] = await db.select().from(categories).limit(1);
    const old = await newProduct(cat.id, 'Added last month', { createdAt: new Date(Date.now() - 30 * 864e5) });
    const today = await call('GET', '/api/admin/products?added=today', adminToken);
    expect(today.json.products.some((p: any) => p.id === old.id)).toBe(false);
    expect(today.json.products.length).toBeGreaterThan(0);
    expect(today.json.summary.addedToday).toBe(today.json.products.length);
    const all = await call('GET', '/api/admin/products', adminToken);
    expect(all.json.products.some((p: any) => p.id === old.id)).toBe(true);
  });
});

describe('One-off clean-up of 5 Nov 2026', () => {
  it('removes the 03:29 import batch only when it is exactly 254 products, and the starter food categories', async () => {
    const { runMaintenance } = await import('../src/services/maintenance.js');
    const log = { info: () => {}, error: () => {} } as any;
    const [soap] = await db.insert(categories).values({ name: 'សាប៊ូ', slug: 'soap-test' }).returning();
    const at = new Date('2026-11-05T03:29:18.123Z');
    const batch = await db
      .insert(products)
      .values(Array.from({ length: 254 }, (_, i) => ({ categoryId: soap.id, name: `POS ${i}`, sku: `POS-${i}`, priceCents: 100, createdAt: at })))
      .returning({ id: products.id });
    const keep = (await db.insert(products).values({ categoryId: soap.id, name: 'Added later', priceCents: 100, createdAt: new Date('2026-11-05T05:00:00Z') }).returning())[0];
    const [household] = await db.insert(categories).values({ name: 'Household', slug: 'household' }).returning();

    const result = (await runMaintenance(log, { force: true, only: 'cleanup-2026-11-05' })) as any;
    expect(result['cleanup-2026-11-05']).toMatchObject({ batch: { removed: 254 }, foodCategories: ['Fresh Produce'] });
    expect((await db.select().from(products).where(inArray(products.id, batch.map((b) => b.id)))).length).toBe(0);
    expect((await db.select().from(products).where(eq(products.id, keep.id))).length).toBe(1);
    expect((await db.select().from(categories).where(eq(categories.slug, 'fresh-produce'))).length).toBe(0);
    expect((await db.select().from(categories).where(eq(categories.id, household.id))).length).toBe(1);
    // Runs once only.
    expect(await runMaintenance(log, { force: true, only: 'cleanup-2026-11-05' })).toBeNull();
  });

  it('gives default-🛒 categories (and their 🛒 products) an emoji that fits their name', async () => {
    const { runMaintenance } = await import('../src/services/maintenance.js');
    const log = { info: () => {}, error: () => {} } as any;
    const [chairs] = await db.insert(categories).values({ name: 'កៅអី', slug: 'chairs-test', emoji: '🛒' }).returning();
    const [mystery] = await db.insert(categories).values({ name: 'XYZ', slug: 'xyz-test', emoji: '🛒' }).returning();
    const [chair] = await db.insert(products).values({ categoryId: chairs.id, name: 'កៅអីបត់', priceCents: 500, emoji: '🛒' }).returning();
    const result = (await runMaintenance(log, { force: true, only: 'category-emojis-2026-11-06' })) as any;
    expect(result['category-emojis-2026-11-06'].changed['កៅអី']).toBe('🪑');
    expect((await db.select().from(categories).where(eq(categories.id, chairs.id)))[0].emoji).toBe('🪑');
    expect((await db.select().from(categories).where(eq(categories.id, mystery.id)))[0].emoji).toBe('🛒');
    expect((await db.select().from(products).where(eq(products.id, chair.id)))[0].emoji).toBe('🪑');
    // New categories get one straight away.
    const created = await call('POST', '/api/admin/categories', adminToken, { name: 'ធុងសម្រាម' });
    expect(created.json.category.emoji).toBe('🗑️');
  });
});

describe('Branches', () => {
  const A = { lat: 11.5564, lng: 104.9282 }; // central Phnom Penh
  const B = { lat: 11.6200, lng: 104.8900 }; // ~8 km north-west
  const nearB = { lat: 11.6150, lng: 104.8920 };
  let token: string;
  let a: number;
  let b: number;
  let soapId: number;

  beforeAll(async () => {
    const [cat] = await db.insert(categories).values({ name: 'Branch test', slug: 'branch-test' }).returning();
    soapId = (await db.insert(products).values({ categoryId: cat.id, name: 'Soap', priceCents: 500, stock: 50 }).returning())[0].id;
    await db.update(shopSettings).set({ deliveryPricing: 'distance', deliveryEnabled: true, pickupEnabled: true });
    token = (await onboard({ id: 9960, first_name: 'Branchy' }, '+85512996000')).token;
    const ra = await call('POST', '/api/admin/branches', adminToken, { name: 'Branch A', address: 'St 1, Phnom Penh', hours: '7am–9pm', lat: A.lat, lng: A.lng });
    const rb = await call('POST', '/api/admin/branches', adminToken, { name: 'Branch B', address: 'St 2, Toul Kork', hours: '8am–8pm', lat: B.lat, lng: B.lng, sortOrder: 1 });
    expect(ra.status).toBe(201);
    a = ra.json.branch.id;
    b = rb.json.branch.id;
  });

  it('lists the branches publicly', async () => {
    const shop = await call('GET', '/api/shop');
    expect(shop.json.branches.map((x: any) => x.name)).toEqual(['Branch A', 'Branch B']);
    expect(shop.json.store).toEqual(A);
  });

  it('prices delivery from the nearest branch, or from the one the customer picks', async () => {
    const items = [{ productId: soapId, quantity: 1 }];
    const near = await call('POST', '/api/checkout/quote', token, { items, fulfillmentType: 'delivery', location: nearB });
    expect(near.json.quote.branch).toMatchObject({ id: b, name: 'Branch B' });
    expect(near.json.quote.branch.distanceKm).toBeLessThan(1.5);
    expect(near.json.quote.branches).toHaveLength(2);
    const picked = await call('POST', '/api/checkout/quote', token, { items, fulfillmentType: 'delivery', location: nearB, branchId: a });
    expect(picked.json.quote.branch.id).toBe(a);
    expect(picked.json.quote.delivery.distanceKm).toBeGreaterThan(near.json.quote.delivery.distanceKm);
    expect(picked.json.quote.delivery.sameDayFeeCents).toBeGreaterThan(near.json.quote.delivery.sameDayFeeCents);
  });

  it('records the branch on the order and shows its pickup address', async () => {
    const r = await order(token, { fulfillmentType: 'pickup', branchId: b, items: [{ productId: soapId, quantity: 2 }] });
    expect(r.json.error ?? null).toBeNull();
    expect(r.status).toBe(201);
    const detail = await call('GET', `/api/orders/${r.json.order.id}`, token);
    expect(detail.json.order).toMatchObject({ branchName: 'Branch B', pickup: { address: 'St 2, Toul Kork', hours: '8am–8pm' } });
  });

  it('never delivers from a branch without a map pin, and distrusts a far-away pin from a link', async () => {
    const { plausibleBranchPin } = await import('../src/services/branches.js');
    expect(plausibleBranchPin({ lat: 40.668, lng: -111.907 }, [A, B])).toBe(false); // USA vs Phnom Penh
    expect(plausibleBranchPin({ lat: 11.57, lng: 104.9 }, [A])).toBe(true);
    const [c] = await db.insert(branches).values({ name: 'Branch C (no pin)', sortOrder: 2 }).returning();
    const items = [{ productId: soapId, quantity: 1 }];
    const q = await call('POST', '/api/checkout/quote', token, { items, fulfillmentType: 'delivery', location: nearB, branchId: c.id });
    expect(q.json.quote.branch.id).toBe(b);
    const p = await call('POST', '/api/checkout/quote', token, { items, fulfillmentType: 'pickup', branchId: c.id });
    expect(p.json.quote.branch.id).toBe(c.id);
    await db.delete(branches).where(eq(branches.id, c.id));
  });

  it('is managed by admins, and the last open branch cannot be removed', async () => {
    const staff = await onboard({ id: 9961, first_name: 'Staff B' }, '+85512996001');
    await db.update(users).set({ role: 'staff' }).where(eq(users.id, staff.user.id));
    expect((await call('POST', '/api/admin/branches', staff.token, { name: 'Nope' })).status).toBe(403);
    expect((await call('DELETE', `/api/admin/branches/${a}`, adminToken)).status).toBe(200);
    const last = await call('DELETE', `/api/admin/branches/${b}`, adminToken);
    expect(last.status).toBe(400);
    expect(last.json.error.code).toBe('last_branch');
  });
});

describe('Security: admin activity log and rate limits', () => {
  it('records every dashboard change (who, what, result) and only admins can read it', async () => {
    const before = (await call('GET', '/api/admin/audit', adminToken)).json.entries.length;
    const [cat] = await db.select().from(categories).limit(1);
    await call('POST', '/api/admin/products', adminToken, { categoryId: cat.id, name: 'Audited', priceCents: 100 });
    const after = await call('GET', '/api/admin/audit', adminToken);
    expect(after.json.entries.length).toBe(Math.min(before + 1, 100));
    expect(after.json.entries[0]).toMatchObject({ method: 'POST', path: '/api/admin/products', status: 201, name: 'Owner' });
    const staff = await onboard({ id: 9970, first_name: 'Nosy' }, '+85512997000');
    await db.update(users).set({ role: 'staff' }).where(eq(users.id, staff.user.id));
    expect((await call('GET', '/api/admin/audit', staff.token)).status).toBe(403);
  });

  it('limits bursts on every API route', async () => {
    let limited = 0;
    for (let i = 0; i < 305; i++) if ((await call('GET', '/api/shop')).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});
