/**
 * Development seed: realistic supermarket catalog, loyalty programme, demo customers and order
 * history. Orders are created through the real checkout/status services so all points, stock and
 * coupon bookkeeping is consistent. Run `npm run db:reset` for a clean slate.
 */
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, pool } from './client.js';
import {
  categories,
  coupons,
  inventoryMovements,
  levels,
  notifications,
  orderEvents,
  orders,
  pointsTransactions,
  products,
  rewards,
  shopSettings,
  users,
  type FulfillmentType,
  type OrderStatus,
} from './schema.js';
import { placeOrder } from '../services/checkout.js';
import { setAutoDispatch } from '../services/notifications.js';
import { completeOnboarding } from '../services/identity.js';
import { changeOrderStatus, changePaymentStatus, DELIVERY_FLOW, PICKUP_FLOW } from '../services/orders.js';
import { confirmQrPayment } from '../services/payments.js';

type P = [name: string, unit: string, price: number, compareAt: number | null, stock: number, emoji: string, desc: string, tags?: string, featured?: boolean];

const CATALOG: { name: string; slug: string; emoji: string; color: string; items: P[] }[] = [
  {
    name: 'Fresh Produce', slug: 'fresh-produce', emoji: '🥬', color: '#22c55e',
    items: [
      ['Bananas', '1 bunch (~6)', 199, null, 60, '🍌', 'Sweet Cavendish bananas, ripe and ready for snacking or smoothies.', 'fruit', true],
      ['Gala Apples', '1 kg bag', 349, 429, 45, '🍎', 'Crisp, sweet Gala apples picked this season.', 'fruit', true],
      ['Hass Avocados', '2 pack', 399, null, 30, '🥑', 'Creamy Hass avocados — perfect for toast and guacamole.', 'fruit'],
      ['Strawberries', '400 g punnet', 449, 549, 25, '🍓', 'Juicy local strawberries, hand-picked.', 'fruit berries', true],
      ['Carrots', '1 kg bag', 149, null, 50, '🥕', 'Crunchy carrots, great raw or roasted.', 'vegetables'],
      ['Vine Tomatoes', '500 g', 279, null, 35, '🍅', 'Fragrant tomatoes ripened on the vine.', 'vegetables'],
      ['Baby Spinach', '150 g bag', 299, null, 20, '🥬', 'Washed and ready-to-eat tender spinach leaves.', 'vegetables salad'],
      ['Lemons', '4 pack', 229, null, 40, '🍋', 'Zesty unwaxed lemons.', 'fruit citrus'],
      ['Broccoli', 'each', 189, null, 0, '🥦', 'Fresh green broccoli crown. Back in stock soon!', 'vegetables'],
    ],
  },
  {
    name: 'Dairy & Eggs', slug: 'dairy-eggs', emoji: '🥚', color: '#0ea5e9',
    items: [
      ['Whole Milk', '1 L', 139, null, 80, '🥛', 'Fresh pasteurised whole milk from local farms.', 'milk'],
      ['Free-Range Eggs', '12 pack', 429, null, 40, '🥚', 'Large free-range eggs.', 'eggs breakfast', true],
      ['Greek Yogurt Natural', '500 g', 329, null, 30, '🥣', 'Thick and creamy strained yogurt, 10% fat.', 'yogurt breakfast'],
      ['Salted Butter', '250 g', 359, null, 35, '🧈', 'Rich churned butter with a pinch of sea salt.', 'butter'],
      ['Mature Cheddar', '400 g', 549, 629, 25, '🧀', 'Full-flavoured cheddar aged 12 months.', 'cheese'],
      ['Fresh Mozzarella', '125 g', 199, null, 3, '🧀', 'Soft mozzarella ball in brine — pizza night essential.', 'cheese'],
    ],
  },
  {
    name: 'Bakery', slug: 'bakery', emoji: '🥖', color: '#f59e0b',
    items: [
      ['Sourdough Loaf', '800 g', 450, null, 18, '🍞', 'Slow-fermented sourdough with a crackly crust, baked this morning.', 'bread', true],
      ['French Baguette', 'each', 179, null, 30, '🥖', 'Classic crusty baguette.', 'bread'],
      ['Butter Croissants', '4 pack', 399, null, 20, '🥐', 'Flaky all-butter croissants.', 'pastry breakfast'],
      ['Whole Wheat Bread', '700 g', 289, null, 25, '🍞', 'Soft sliced wholemeal sandwich bread.', 'bread'],
      ['Blueberry Muffins', '4 pack', 429, 499, 15, '🧁', 'Moist muffins packed with blueberries.', 'cake sweet'],
    ],
  },
  {
    name: 'Meat & Seafood', slug: 'meat-seafood', emoji: '🍗', color: '#f43f5e',
    items: [
      ['Chicken Breast Fillets', '500 g', 649, null, 25, '🍗', 'Skinless, boneless free-range chicken breast.', 'chicken poultry'],
      ['Lean Ground Beef 5%', '500 g', 599, null, 20, '🥩', 'Lean minced beef, ideal for bolognese and burgers.', 'beef mince'],
      ['Atlantic Salmon Fillets', '2 × 125 g', 799, 949, 15, '🐟', 'Responsibly farmed salmon fillets, skin on.', 'fish', true],
      ['Pork Sausages', '6 pack', 449, null, 20, '🌭', 'Butcher-style pork sausages with herbs.', 'pork bbq'],
    ],
  },
  {
    name: 'Drinks', slug: 'drinks', emoji: '🧃', color: '#3b82f6',
    items: [
      ['Still Mineral Water', '6 × 1.5 L', 399, null, 50, '💧', 'Natural mineral water from mountain springs.', 'water'],
      ['Orange Juice', '1 L', 349, null, 30, '🧃', '100% squeezed orange juice, not from concentrate.', 'juice breakfast'],
      ['Cola', '6 × 330 ml cans', 479, 549, 40, '🥤', 'Classic cola, ice-cold refreshment.', 'soda soft drink', true],
      ['Sparkling Water Lime', '1 L', 119, null, 45, '🫧', 'Lightly sparkling water with a hint of lime.', 'water soda'],
      ['Ground Coffee Medium Roast', '250 g', 699, null, 25, '☕', 'Smooth medium roast with chocolate notes.', 'coffee'],
      ['Green Tea', '40 bags', 329, null, 30, '🍵', 'Delicate sencha-style green tea.', 'tea'],
    ],
  },
  {
    name: 'Snacks', slug: 'snacks', emoji: '🍿', color: '#f97316',
    items: [
      ['Sea Salt Potato Chips', '150 g', 249, null, 40, '🥔', 'Kettle-cooked chips with sea salt.', 'crisps chips'],
      ['Dark Chocolate 70%', '100 g', 279, null, 50, '🍫', 'Intense dark chocolate bar, fair-trade cocoa.', 'chocolate sweet', true],
      ['Salted Mixed Nuts', '200 g', 499, null, 25, '🥜', 'Roasted almonds, cashews and peanuts.', 'nuts'],
      ['Microwave Popcorn', '3 pack', 299, null, 30, '🍿', 'Butter popcorn for movie night.', 'popcorn'],
      ['Chocolate Chip Cookies', '300 g', 319, 399, 35, '🍪', 'Crunchy cookies loaded with chocolate chips.', 'biscuits sweet'],
      ['Gummy Bears', '200 g', 199, null, 40, '🐻', 'Fruity gummy bears in five flavours.', 'candy sweet'],
    ],
  },
  {
    name: 'Pantry', slug: 'pantry', emoji: '🥫', color: '#ca8a04',
    items: [
      ['Spaghetti', '500 g', 129, null, 60, '🍝', 'Bronze-cut durum wheat spaghetti.', 'pasta'],
      ['Basmati Rice', '1 kg', 349, null, 40, '🍚', 'Fragrant long-grain basmati rice.', 'rice'],
      ['Extra Virgin Olive Oil', '500 ml', 749, null, 20, '🫒', 'Cold-pressed olive oil, fruity and peppery.', 'oil'],
      ['Chopped Tomatoes', '400 g can', 99, null, 80, '🥫', 'Italian chopped tomatoes in juice.', 'canned'],
      ['Rolled Oats', '1 kg', 269, null, 35, '🌾', 'Wholegrain rolled oats for porridge and baking.', 'breakfast cereal'],
      ['Wildflower Honey', '340 g', 529, null, 20, '🍯', 'Pure runny honey from local beekeepers.', 'honey sweet'],
    ],
  },
  {
    name: 'Household', slug: 'household', emoji: '🧽', color: '#8b5cf6',
    items: [
      ['Dishwashing Liquid', '500 ml', 249, null, 30, '🍽️', 'Grease-cutting lemon dish soap.', 'cleaning'],
      ['Laundry Detergent Pods', '30 pack', 1199, 1399, 20, '🧺', 'All-in-one laundry pods for brighter whites.', 'laundry'],
      ['Paper Towels', '4 rolls', 549, null, 25, '🧻', 'Strong, absorbent kitchen rolls.', 'paper'],
      ['Toilet Paper', '9 rolls', 699, null, 30, '🧻', 'Soft 3-ply toilet tissue.', 'paper'],
      ['Kitchen Sponges', '5 pack', 229, null, 35, '🧽', 'Dual-sided scrub sponges.', 'cleaning'],
      ['Trash Bags 30 L', '40 pack', 449, null, 25, '🗑️', 'Tie-top bin bags, leak resistant.', 'bags'],
    ],
  },
  {
    name: 'Personal Care', slug: 'personal-care', emoji: '🧴', color: '#ec4899',
    items: [
      ['Fresh Mint Toothpaste', '100 ml', 299, null, 35, '🪥', 'Fluoride toothpaste for fresh breath.', 'dental'],
      ['Everyday Shampoo', '400 ml', 499, null, 25, '🧴', 'Gentle shampoo for all hair types.', 'hair'],
      ['Aloe Hand Soap', '250 ml', 249, null, 30, '🧼', 'Moisturising liquid hand soap with aloe vera.', 'soap'],
      ['Sunscreen SPF 50', '200 ml', 999, 1199, 15, '☀️', 'Water-resistant broad-spectrum sun lotion.', 'sun skin'],
      ['Lip Balm', '4.8 g', 179, null, 40, '💄', 'Nourishing lip balm with shea butter.', 'lips skin'],
    ],
  },
];

// Deterministic pseudo-random so every seed looks the same.
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

/**
 * Production starter: shop settings, levels, a welcome coupon, milestone rewards and the aisles —
 * no products, customers or orders. Safe to run repeatedly (does nothing once aisles exist).
 */
export async function seedStarter(log: (m: string) => void = console.log) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(categories);
  if (n > 0) return false;
  log('🌱 First boot: creating starter shop setup (settings, levels, rewards, aisles)…');
  await db.insert(shopSettings).values({ id: 1 }).onConflictDoNothing();
  await db.update(shopSettings).set({
    deliveryFeeCents: 150,
    freeDeliveryMinCents: 2500,
    minOrderCents: 500,
    pickupHours: 'Daily 8:00–21:00',
    pointsPerDollar: 1,
    signupBonusPoints: 50,
    rewardExpiryDays: 90,
    cashEnabled: true,
    // QR stays off until ABA PayWay is connected (simulated payments are disabled in production).
    qrPaymentMode: 'off',
  }).where(eq(shopSettings.id, 1));
  await db.insert(levels).values([
    { name: 'Sprout', emoji: '🌱', minPoints: 0, multiplierPercent: 100, color: '#22c55e' },
    { name: 'Leaf', emoji: '🌿', minPoints: 300, multiplierPercent: 110, color: '#16a34a' },
    { name: 'Sunflower', emoji: '🌻', minPoints: 800, multiplierPercent: 125, color: '#eab308' },
    { name: 'Mighty Oak', emoji: '🌳', minPoints: 2000, multiplierPercent: 150, color: '#a16207' },
  ]).onConflictDoNothing();
  const [welcome] = await db
    .insert(coupons)
    .values({ title: 'Welcome 10% off', description: 'Your first-basket thank-you: 10% off (up to $5) on orders over $15.', discountType: 'percent', value: 10, maxDiscountCents: 500, minSubtotalCents: 1500, perCustomerLimit: null })
    .returning();
  await db.update(shopSettings).set({ welcomeCouponId: welcome.id }).where(eq(shopSettings.id, 1));
  const milestones = [
    { points: 100, title: 'Free delivery', emoji: '🚚', description: 'Your next delivery is on us.', benefit: { discountType: 'free_delivery' as const } },
    { points: 250, title: '$3 off your basket', emoji: '🎁', description: '$3 off any order of $15 or more.', benefit: { discountType: 'fixed' as const, value: 300, minSubtotalCents: 1500 } },
    { points: 500, title: '$5 off your basket', emoji: '💵', description: '$5 off any order of $25 or more.', benefit: { discountType: 'fixed' as const, value: 500, minSubtotalCents: 2500 } },
    { points: 1000, title: '$10 off your basket', emoji: '🏆', description: '$10 off any order of $40 or more.', benefit: { discountType: 'fixed' as const, value: 1000, minSubtotalCents: 4000 } },
  ];
  for (const m of milestones) {
    const [c] = await db.insert(coupons).values({ title: m.title, description: m.description, perCustomerLimit: null, ...m.benefit }).returning();
    await db.insert(rewards).values({ title: m.title, description: m.description, emoji: m.emoji, pointsRequired: m.points, couponId: c.id });
  }
  let sort = 0;
  for (const cat of CATALOG) {
    await db.insert(categories).values({ name: cat.name, slug: cat.slug, emoji: cat.emoji, color: cat.color, sortOrder: sort++ });
  }
  log('✅ Starter setup ready. Next: Dashboard → Settings (shop name, pickup address, fees) and Catalog (add products).');
  return true;
}

export async function seedDemo() {
  setAutoDispatch(false);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(categories);
  if (n > 0) {
    console.log('ℹ️  Database already has data — run `npm run db:reset` for a fresh seed.');
    return;
  }

  console.log('🌱 Seeding shop settings & catalog…');
  await db.insert(shopSettings).values({
    id: 1,
    shopName: 'Sunny Market',
    tagline: 'Fresh groceries, happy rewards',
    currency: 'USD',
    deliveryFeeCents: 299,
    freeDeliveryMinCents: 3500,
    minOrderCents: 1000,
    pickupAddress: '12 Market Street — customer service desk',
    pickupHours: 'Daily 8:00–21:00',
    supportPhone: '+1 555 010 2030',
    pointsPerDollar: 1,
    signupBonusPoints: 50,
    rewardExpiryDays: 90,
    cashEnabled: true,
    qrPaymentMode: 'simulated',
    paymentWindowMinutes: 30,
  }).onConflictDoNothing();

  const productIds: Record<string, number> = {};
  let sort = 0;
  for (const cat of CATALOG) {
    const [c] = await db.insert(categories).values({ name: cat.name, slug: cat.slug, emoji: cat.emoji, color: cat.color, sortOrder: sort++ }).returning();
    for (const [name, unit, price, compareAt, stock, emoji, description, tags, featured] of cat.items) {
      const [p] = await db
        .insert(products)
        .values({ categoryId: c.id, name, unit, priceCents: price, compareAtCents: compareAt, stock, emoji, description, tags: tags ?? '', featured: !!featured })
        .returning();
      productIds[name] = p.id;
      if (stock > 0) await db.insert(inventoryMovements).values({ productId: p.id, delta: stock, stockAfter: stock, reason: 'initial', note: 'Seed' });
    }
  }

  console.log('🎁 Seeding loyalty programme…');
  await db.insert(levels).values([
    { name: 'Sprout', emoji: '🌱', minPoints: 0, multiplierPercent: 100, color: '#22c55e' },
    { name: 'Leaf', emoji: '🌿', minPoints: 300, multiplierPercent: 110, color: '#16a34a' },
    { name: 'Sunflower', emoji: '🌻', minPoints: 800, multiplierPercent: 125, color: '#eab308' },
    { name: 'Mighty Oak', emoji: '🌳', minPoints: 2000, multiplierPercent: 150, color: '#a16207' },
  ]);

  const [welcome] = await db
    .insert(coupons)
    .values({ title: 'Welcome 10% off', description: 'Your first-basket thank-you: 10% off (up to $5) on orders over $15.', discountType: 'percent', value: 10, maxDiscountCents: 500, minSubtotalCents: 1500, perCustomerLimit: null })
    .returning();
  await db.update(shopSettings).set({ welcomeCouponId: welcome.id }).where(eq(shopSettings.id, 1));

  await db.insert(coupons).values([
    { code: 'FRESH5', title: '$5 off orders over $40', description: 'Stock up and save. One use per customer.', discountType: 'fixed', value: 500, minSubtotalCents: 4000, perCustomerLimit: 1, maxRedemptions: 500, isPublic: true },
    { code: 'SUNNY15', title: '15% off big baskets', description: '15% off (up to $10) when you spend $60 or more.', discountType: 'percent', value: 15, maxDiscountCents: 1000, minSubtotalCents: 6000, perCustomerLimit: 2, isPublic: true },
  ]);

  const milestone = async (pointsRequired: number, title: string, emoji: string, description: string, benefit: Partial<typeof coupons.$inferInsert> & { discountType: 'percent' | 'fixed' | 'free_delivery' | 'free_product' }, isSurprise = false) => {
    const [c] = await db.insert(coupons).values({ title, description, perCustomerLimit: null, ...benefit }).returning();
    await db.insert(rewards).values({ title, description, emoji, pointsRequired, couponId: c.id, isSurprise });
  };
  await milestone(100, 'Free delivery', '🚚', 'Your next delivery is on us.', { discountType: 'free_delivery' });
  await milestone(250, 'Surprise gift', '🍫', 'A free bar of our 70% dark chocolate with your next order!', { discountType: 'free_product', freeProductId: productIds['Dark Chocolate 70%'] }, true);
  await milestone(500, '$5 off your basket', '💵', '$5 off any order of $25 or more.', { discountType: 'fixed', value: 500, minSubtotalCents: 2500 });
  await milestone(1000, 'Free coffee', '☕', 'A free bag of our medium roast ground coffee.', { discountType: 'free_product', freeProductId: productIds['Ground Coffee Medium Roast'] });

  console.log('👥 Seeding demo customers via the real onboarding flow…');
  await db.insert(users).values({ telegramId: 100000009, firstName: 'Sam', lastName: 'Store', username: 'sam_manager', role: 'admin', privacyAcceptedAt: new Date(), signupSource: 'admin', phone: '+15550100009' });

  const people = [
    { telegramId: 100000001, firstName: 'Alice', lastName: 'Green', username: 'alice_dev', phone: '+15550100001', source: 'store' },
    { telegramId: 100000002, firstName: 'Ben', lastName: 'Ortiz', username: 'ben_o', phone: '+15550100002', source: 'receipt' },
    { telegramId: 100000003, firstName: 'Chloe', lastName: 'Martin', username: null, phone: '+15550100003', source: 'store' },
    { telegramId: 100000004, firstName: 'Diego', lastName: 'Silva', username: 'diegos', phone: '+15550100004', source: 'receipt' },
    { telegramId: 100000005, firstName: 'Emma', lastName: 'Novak', username: 'emma_n', phone: '+15550100005', source: 'flyer' },
    { telegramId: 100000006, firstName: 'Farah', lastName: 'Khan', username: null, phone: '+15550100006', source: 'store' },
  ];
  const created = [];
  for (const p of people) {
    const r = await completeOnboarding(
      { telegramId: p.telegramId, firstName: p.firstName, lastName: p.lastName, username: p.username, photoUrl: null, languageCode: 'en', startParam: p.source },
      { firstName: p.firstName, lastName: p.lastName, phone: p.phone, acceptPrivacy: true },
    );
    created.push(r.user);
  }

  console.log('🧾 Seeding order history through checkout…');
  const sam = (await db.select().from(users).where(eq(users.telegramId, 100000009)))[0];
  const everyday = Object.keys(productIds).filter((n) => n !== 'Broccoli');
  const addr = { label: 'Home', line1: '', city: 'Springfield', postalCode: '12345', instructions: 'Ring the bell twice', save: true };
  const streets = ['48 Maple Avenue', '7 Oak Lane, Apt 3B', '102 River Road', '15 Elm Street', '230 Hill Crescent', '9 Station Square'];

  const plan: { who: number; daysAgo: number; final: OrderStatus; type: FulfillmentType; pay?: 'paid' | 'refunded'; qr?: boolean }[] = [];
  for (let d = 13; d >= 1; d--) {
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const type: FulfillmentType = rand() < 0.65 ? 'delivery' : 'pickup';
      const roll = rand();
      plan.push({ who: 1 + Math.floor(rand() * 5), daysAgo: d, type, final: roll < 0.1 ? 'cancelled' : type === 'delivery' ? 'delivered' : 'collected', pay: roll > 0.97 ? 'refunded' : 'paid', qr: rand() < 0.45 });
    }
  }
  // Alice: two completed orders so her Rewards page is lively; plus today's active orders for the dashboard.
  plan.push({ who: 0, daysAgo: 6, type: 'delivery', final: 'delivered', pay: 'paid' }, { who: 0, daysAgo: 2, type: 'pickup', final: 'collected', pay: 'paid' });
  plan.push(
    { who: 2, daysAgo: 3, type: 'delivery', final: 'cancelled' },
    { who: 3, daysAgo: 0, type: 'pickup', final: 'ready_for_pickup' },
    { who: 4, daysAgo: 0, type: 'delivery', final: 'preparing', qr: true },
    { who: 5, daysAgo: 0, type: 'pickup', final: 'awaiting_payment', qr: true },
    { who: 2, daysAgo: 0, type: 'delivery', final: 'confirmed' },
    { who: 5, daysAgo: 0, type: 'delivery', final: 'placed' },
    { who: 1, daysAgo: 0, type: 'pickup', final: 'placed' },
  );

  for (const step of plan) {
    const user = (await db.select().from(users).where(eq(users.id, created[step.who].id)))[0];
    const lines = new Map<number, number>();
    const n = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < n; i++) {
      const id = productIds[pick(everyday)];
      lines.set(id, Math.min(3, (lines.get(id) ?? 0) + 1));
    }
    let result;
    try {
      result = await placeOrder(user, {
        items: [...lines.entries()].map(([productId, quantity]) => ({ productId, quantity })),
        fulfillmentType: step.type,
        idempotencyKey: randomUUID(),
        paymentMethod: step.qr ? 'qr' : 'cash',
        contactName: `${user.firstName} ${user.lastName ?? ''}`.trim(),
        contactPhone: user.phone ?? '+15550000000',
        address: step.type === 'delivery' ? { ...addr, line1: streets[step.who] } : null,
        note: rand() < 0.25 ? pick(['Please pick ripe avocados 🙏', 'Leave at the door', 'Call when outside', 'No plastic bags please']) : null,
      });
    } catch (err) {
      console.log(`   (skipped a random basket: ${(err as Error).message})`);
      continue; // e.g. something sold out or below the minimum order — skip
    }
    const orderId = result.orderId;
    const flow = step.type === 'delivery' ? DELIVERY_FLOW : PICKUP_FLOW;
    if (step.final === 'awaiting_payment') continue; // customer hasn't paid yet — the shop doesn't see it
    if (step.qr && step.final !== 'cancelled') {
      await confirmQrPayment(orderId, { note: 'SIMULATED QR payment — demo only, no money was charged.' });
    }
    if (step.final === 'cancelled') {
      await changeOrderStatus({ orderId, to: 'cancelled', actor: sam, reason: pick(['Customer requested', 'Item unavailable']) });
    } else {
      for (const st of flow.slice(1, flow.indexOf(step.final) + 1)) {
        if (!step.qr && (st === 'delivered' || st === 'collected')) await changePaymentStatus({ orderId, to: 'paid', actor: sam });
        await changeOrderStatus({ orderId, to: st, actor: sam });
      }
      if (step.pay === 'refunded' && (step.final === 'delivered' || step.final === 'collected')) {
        await changePaymentStatus({ orderId, to: 'refunded', actor: sam, note: 'Damaged items — full refund' });
      }
    }
    // Backdate for realistic insights.
    if (step.daysAgo > 0) {
      const offset = sql`make_interval(days => ${step.daysAgo}, hours => ${Math.floor(rand() * 8)})`;
      await db.update(orders).set({
        placedAt: sql`${orders.placedAt} - ${offset}`,
        completedAt: sql`${orders.completedAt} - ${offset}`,
        cancelledAt: sql`${orders.cancelledAt} - ${offset}`,
        updatedAt: sql`${orders.updatedAt} - ${offset}`,
      }).where(eq(orders.id, orderId));
      await db.update(orderEvents).set({ createdAt: sql`${orderEvents.createdAt} - ${offset} + make_interval(mins => ${orderEvents.id} % 50)` }).where(eq(orderEvents.orderId, orderId));
      await db.update(pointsTransactions).set({ createdAt: sql`${pointsTransactions.createdAt} - ${offset}` }).where(eq(pointsTransactions.orderId, orderId));
    }
  }
  // Customers joined over the last two weeks.
  await db.execute(sql`update users set created_at = now() - make_interval(days => 14 - (id % 13)) where role = 'customer'`);
  // Seed activity shouldn't send/print a burst of messages.
  await db.delete(notifications);

  const [{ orderCount }] = await db.select({ orderCount: sql<number>`count(*)::int` }).from(orders);
  const alice = (await db.select().from(users).where(eq(users.telegramId, 100000001)))[0];
  console.log(`✅ Seeded ${Object.keys(productIds).length} products, ${people.length} customers, ${orderCount} orders. Alice has ${alice.pointsBalance} points.`);
  console.log('   Dev logins: "Alice (returning customer)", "Sam (shop admin)", or "New customer" for onboarding.');
}

// CLI: `npm run db:seed` (demo data for development) or `npm run db:seed:starter` (production starter).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const run = process.argv.includes('--starter') ? () => seedStarter().then((done) => { if (!done) console.log('ℹ️  Already set up — nothing to do.'); }) : seedDemo;
  run()
    .catch((err) => {
      console.error('❌ Seed failed', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
