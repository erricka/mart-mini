/**
 * Seed data for mart25 (Khmer first, with optional English names).
 *  - `npm run db:seed:starter` / SEED_ON_START=starter: production starter — settings, levels, rewards, aisles. No demo data.
 *  - `npm run db:seed`: development demo — catalog, customers and order history created through the real
 *    checkout/status services so points, stock and coupon bookkeeping stay consistent.
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

// [khmer name, english name, unit, price¢, compare-at¢, stock, emoji, khmer description, english description, tags, featured]
type P = [string, string, string, number, number | null, number, string, string, string, string?, boolean?];

export const CATALOG: { name: string; nameEn: string; slug: string; emoji: string; color: string; items: P[] }[] = [
  {
    name: 'បន្លែ និងផ្លែឈើ', nameEn: 'Fresh Produce', slug: 'fresh-produce', emoji: '🥬', color: '#22c55e',
    items: [
      ['ស្វាយកែវរមៀត', 'Keo Romeat Mangoes', '1 kg', 250, null, 40, '🥭', 'ស្វាយកែវរមៀតទុំ ផ្អែមឆ្ងាញ់។', 'Sweet ripe Keo Romeat mangoes.', 'fruit mango ស្វាយ', true],
      ['ចេកអំបូង', 'Bananas', '~6 pcs', 199, null, 60, '🍌', 'ចេកទុំ ផ្អែមឆ្ងាញ់ ល្អសម្រាប់ញ៉ាំផ្ទាល់ ឬធ្វើទឹកក្រឡុក។', 'Sweet ripe bananas for snacking or smoothies.', 'fruit banana ចេក', true],
      ['ផ្លែប៉ោមហ្គាឡា', 'Gala Apples', '1 kg', 349, 429, 45, '🍎', 'ផ្លែប៉ោមហ្គាឡា ស្រួយ ផ្អែម។', 'Crisp, sweet Gala apples.', 'fruit apple ប៉ោម'],
      ['ផ្លែបឺរ', 'Avocados', '2 pcs', 399, null, 30, '🥑', 'ផ្លែបឺរខ្លាញ់ទន់ ល្អសម្រាប់សាឡាត់ ឬទឹកក្រឡុក។', 'Creamy avocados for salads and smoothies.', 'fruit avocado'],
      ['ផ្លែស្ត្របឺរី', 'Strawberries', '400 g', 449, 549, 25, '🍓', 'ស្ត្របឺរីស្រស់ ទុំក្រហម។', 'Juicy fresh strawberries.', 'fruit berries'],
      ['ការ៉ុត', 'Carrots', '1 kg', 149, null, 50, '🥕', 'ការ៉ុតស្រួយ ល្អសម្រាប់ស្ងោរ ឆា ឬញ៉ាំស្រស់។', 'Crunchy carrots, great raw or cooked.', 'vegetables'],
      ['ប៉េងប៉ោះ', 'Tomatoes', '500 g', 279, null, 35, '🍅', 'ប៉េងប៉ោះស្រស់ ទុំល្អ។', 'Fresh ripe tomatoes.', 'vegetables'],
      ['ត្រកួន', 'Morning Glory', '250 g', 99, null, 40, '🥬', 'ត្រកួនស្រស់ ល្អសម្រាប់ឆាខ្ទឹមស។', 'Fresh morning glory — perfect stir-fried with garlic.', 'vegetables'],
      ['ក្រូចឆ្មា', 'Limes', '6 pcs', 129, null, 40, '🍋', 'ក្រូចឆ្មាស្រស់ ទឹកច្រើន។', 'Juicy fresh limes.', 'fruit lime'],
      ['ផ្កាខាត់ណាខៀវ', 'Broccoli', '1 pc', 189, null, 0, '🥦', 'ផ្កាខាត់ណាខៀវស្រស់។ នឹងមានស្តុកឆាប់ៗ!', 'Fresh green broccoli. Back in stock soon!', 'vegetables'],
    ],
  },
  {
    name: 'ទឹកដោះគោ និងពង', nameEn: 'Dairy & Eggs', slug: 'dairy-eggs', emoji: '🥚', color: '#0ea5e9',
    items: [
      ['ទឹកដោះគោស្រស់', 'Fresh Milk', '1 L', 139, null, 80, '🥛', 'ទឹកដោះគោស្រស់ ឆ្លងកាត់ការសម្លាប់មេរោគ។', 'Fresh pasteurised whole milk.', 'milk'],
      ['ពងមាន់ស្រែ', 'Free-Range Eggs', '12 pcs', 429, null, 40, '🥚', 'ពងមាន់ស្រែ ស្រស់ៗ។', 'Fresh free-range eggs.', 'eggs ពង', true],
      ['យ៉ាអួ', 'Greek Yogurt', '500 g', 329, null, 30, '🥣', 'យ៉ាអួធម្មជាតិ ខាប់ និងទន់រលោង។', 'Thick, creamy natural yogurt.', 'yogurt'],
      ['ប៊័រ', 'Salted Butter', '250 g', 359, null, 35, '🧈', 'ប៊័រប្រៃ រសជាតិឆ្ងាញ់។', 'Rich butter with a pinch of salt.', 'butter'],
      ['ឈីសឆេដា', 'Cheddar Cheese', '400 g', 549, 629, 25, '🧀', 'ឈីសឆេដា រសជាតិខ្លាំង។', 'Full-flavoured mature cheddar.', 'cheese'],
      ['ឈីសម៉ូហ្សារ៉ែឡា', 'Mozzarella', '125 g', 199, null, 3, '🧀', 'ឈីសម៉ូហ្សារ៉ែឡាទន់ សម្រាប់ធ្វើភីហ្សា។', 'Soft mozzarella — pizza night essential.', 'cheese'],
    ],
  },
  {
    name: 'នំប៉័ង និងនំ', nameEn: 'Bakery', slug: 'bakery', emoji: '🥖', color: '#f59e0b',
    items: [
      ['នំប៉័ងបារាំង', 'Baguette', '1 pc', 75, null, 40, '🥖', 'នំប៉័ងបារាំងស្រួយ ដុតថ្មីៗរៀងរាល់ព្រឹក។', 'Crusty baguette, baked fresh every morning.', 'bread នំប៉័ង', true],
      ['នំប៉័ងសូដូ', 'Sourdough Loaf', '800 g', 450, null, 18, '🍞', 'នំប៉័ងសូដូ ដុតយឺតៗ សំបកស្រួយ។', 'Slow-fermented sourdough with a crackly crust.', 'bread'],
      ['នំក្រូសង់', 'Butter Croissants', '4 pcs', 399, null, 20, '🥐', 'នំក្រូសង់ប៊័រ ស្រួយៗ។', 'Flaky all-butter croissants.', 'pastry'],
      ['នំប៉័ងស្រូវសាលី', 'Whole Wheat Bread', '700 g', 289, null, 25, '🍞', 'នំប៉័ងស្រូវសាលីកាត់ស្រាប់ ទន់ល្អ។', 'Soft sliced wholemeal bread.', 'bread'],
      ['នំម៉ាហ្វីនប៊្លូបឺរី', 'Blueberry Muffins', '4 pcs', 429, 499, 15, '🧁', 'នំម៉ាហ្វីនទន់ ពោរពេញដោយប៊្លូបឺរី។', 'Moist muffins packed with blueberries.', 'cake'],
    ],
  },
  {
    name: 'សាច់ និងគ្រឿងសមុទ្រ', nameEn: 'Meat & Seafood', slug: 'meat-seafood', emoji: '🍗', color: '#f43f5e',
    items: [
      ['សាច់ទ្រូងមាន់', 'Chicken Breast', '500 g', 649, null, 25, '🍗', 'សាច់ទ្រូងមាន់ គ្មានឆ្អឹង គ្មានស្បែក។', 'Skinless, boneless chicken breast.', 'chicken សាច់មាន់'],
      ['សាច់ជ្រូកបីជាន់', 'Pork Belly', '500 g', 449, null, 20, '🥓', 'សាច់ជ្រូកបីជាន់ស្រស់ សម្រាប់អាំង ឬខ។', 'Fresh pork belly for grilling or braising.', 'pork សាច់ជ្រូក'],
      ['សាច់គោចិញ្ច្រាំ', 'Ground Beef', '500 g', 599, null, 20, '🥩', 'សាច់គោចិញ្ច្រាំ ខ្លាញ់តិច។', 'Lean minced beef.', 'beef សាច់គោ'],
      ['ត្រីសាម៉ុង', 'Salmon Fillets', '2 × 125 g', 799, 949, 15, '🐟', 'ត្រីសាម៉ុងហ្វីលេ ស្រស់ល្អ។', 'Fresh salmon fillets, skin on.', 'fish ត្រី', true],
    ],
  },
  {
    name: 'ភេសជ្ជៈ', nameEn: 'Drinks', slug: 'drinks', emoji: '🧃', color: '#3b82f6',
    items: [
      ['ទឹកសុទ្ធ', 'Drinking Water', '6 × 1.5 L', 250, null, 50, '💧', 'ទឹកបរិសុទ្ធ សម្រាប់ផឹកប្រចាំថ្ងៃ។', 'Pure drinking water.', 'water ទឹក'],
      ['ទឹកដូង', 'Coconut Water', '1 L', 199, null, 45, '🥥', 'ទឹកដូងក្រអូប ស្រស់ថ្លា។', 'Fragrant fresh coconut water.', 'coconut ដូង', true],
      ['ទឹកក្រូចច្របាច់', 'Orange Juice', '1 L', 349, null, 30, '🧃', 'ទឹកក្រូច 100% មិនលាយ។', '100% squeezed orange juice.', 'juice'],
      ['ភេសជ្ជៈកូឡា', 'Cola', '6 × 330 ml', 479, 549, 40, '🥤', 'ភេសជ្ជៈកូឡាត្រជាក់ៗ។', 'Classic cola, ice-cold refreshment.', 'soda'],
      ['កាហ្វេម៉ត់', 'Ground Coffee', '250 g', 699, null, 25, '☕', 'កាហ្វេម៉ត់លីងមធ្យម ក្លិនក្រអូប។', 'Smooth medium-roast ground coffee.', 'coffee កាហ្វេ'],
      ['តែបៃតង', 'Green Tea', '40 bags', 329, null, 30, '🍵', 'តែបៃតង រសជាតិស្រាល។', 'Delicate green tea.', 'tea តែ'],
    ],
  },
  {
    name: 'នំចំណី', nameEn: 'Snacks', slug: 'snacks', emoji: '🍿', color: '#f97316',
    items: [
      ['គ្រាប់ស្វាយចន្ទីលីង', 'Roasted Cashews', '200 g', 499, null, 25, '🥜', 'គ្រាប់ស្វាយចន្ទីខ្មែរលីង ប្រៃល្មម។', 'Roasted Cambodian cashews, lightly salted.', 'nuts', true],
      ['សូកូឡាខ្មៅ 70%', 'Dark Chocolate 70%', '100 g', 279, null, 50, '🍫', 'សូកូឡាខ្មៅ 70% រសជាតិខ្លាំង។', 'Intense 70% dark chocolate.', 'chocolate'],
      ['ដំឡូងបារាំងចៀន', 'Potato Chips', '150 g', 249, null, 40, '🥔', 'ដំឡូងចៀនស្រួយ ប្រៃល្មម។', 'Crunchy sea-salt potato chips.', 'chips'],
      ['ពោតលីង', 'Popcorn', '3 pcs', 299, null, 30, '🍿', 'ពោតលីងប៊័រ សម្រាប់មើលកុន។', 'Butter popcorn for movie night.', 'popcorn'],
      ['នំខូឃី', 'Chocolate Chip Cookies', '300 g', 319, 399, 35, '🍪', 'នំខូឃីស្រួយ ពោរពេញសូកូឡា។', 'Crunchy cookies loaded with chocolate chips.', 'biscuits'],
      ['ស្ករគ្រាប់ជែលលី', 'Gummy Bears', '200 g', 199, null, 40, '🐻', 'ស្ករគ្រាប់ជែលលី រសផ្លែឈើ។', 'Fruity gummy bears.', 'candy'],
    ],
  },
  {
    name: 'គ្រឿងទេស និងអង្ករ', nameEn: 'Pantry', slug: 'pantry', emoji: '🍚', color: '#ca8a04',
    items: [
      ['អង្ករផ្កាម្លិះ', 'Jasmine Rice', '5 kg', 650, null, 40, '🍚', 'អង្ករផ្កាម្លិះខ្មែរ ក្រអូប ទន់ឆ្ងាញ់។', 'Fragrant Cambodian jasmine rice.', 'rice អង្ករ', true],
      ['ទឹកត្រី', 'Fish Sauce', '700 ml', 199, null, 50, '🍶', 'ទឹកត្រីឆ្ងាញ់ សម្រាប់ចម្អិនម្ហូបខ្មែរ។', 'Classic fish sauce for Khmer cooking.', 'sauce'],
      ['មីស្ប៉ាហ្គេទី', 'Spaghetti', '500 g', 129, null, 60, '🍝', 'មីស្ប៉ាហ្គេទី ពីស្រូវសាលីដុរ៉ុម។', 'Durum wheat spaghetti.', 'pasta'],
      ['ប្រេងអូលីវ', 'Olive Oil', '500 ml', 749, null, 20, '🫒', 'ប្រេងអូលីវបរិសុទ្ធ។', 'Extra virgin olive oil.', 'oil'],
      ['ប៉េងប៉ោះកំប៉ុង', 'Chopped Tomatoes', '400 g', 99, null, 80, '🥫', 'ប៉េងប៉ោះហាន់ ក្នុងកំប៉ុង។', 'Chopped tomatoes in juice.', 'canned'],
      ['ទឹកឃ្មុំព្រៃ', 'Wild Honey', '340 g', 529, null, 20, '🍯', 'ទឹកឃ្មុំព្រៃធម្មជាតិ។', 'Pure natural wild honey.', 'honey'],
    ],
  },
  {
    name: 'សម្ភារប្រើប្រាស់ក្នុងផ្ទះ', nameEn: 'Household', slug: 'household', emoji: '🧽', color: '#8b5cf6',
    items: [
      ['ទឹកលាងចាន', 'Dishwashing Liquid', '500 ml', 249, null, 30, '🍽️', 'ទឹកលាងចានក្លិនក្រូចឆ្មា ជម្រះខ្លាញ់បានល្អ។', 'Grease-cutting lemon dish soap.', 'cleaning'],
      ['គ្រាប់សាប៊ូបោកខោអាវ', 'Laundry Pods', '30 pcs', 1199, 1399, 20, '🧺', 'គ្រាប់សាប៊ូបោកខោអាវ ធ្វើឱ្យខោអាវស្អាតភ្លឺ។', 'All-in-one laundry pods.', 'laundry'],
      ['ក្រដាសជូតផ្ទះបាយ', 'Paper Towels', '4 rolls', 549, null, 25, '🧻', 'ក្រដាសជូតផ្ទះបាយ ស្រូបទឹកបានល្អ។', 'Strong, absorbent kitchen rolls.', 'paper'],
      ['ក្រដាសអនាម័យ', 'Toilet Paper', '10 rolls', 699, null, 30, '🧻', 'ក្រដាសអនាម័យទន់ 3 ស្រទាប់។', 'Soft 3-ply toilet tissue.', 'paper'],
      ['អេប៉ុងលាងចាន', 'Kitchen Sponges', '5 pcs', 229, null, 35, '🧽', 'អេប៉ុងលាងចាន ពីរមុខ។', 'Dual-sided scrub sponges.', 'cleaning'],
      ['ថង់សំរាម', 'Trash Bags 30 L', '40 pcs', 449, null, 25, '🗑️', 'ថង់សំរាមមានខ្សែចង មិនងាយធ្លាយ។', 'Tie-top bin bags, leak resistant.', 'bags'],
    ],
  },
  {
    name: 'ថែទាំខ្លួន', nameEn: 'Personal Care', slug: 'personal-care', emoji: '🧴', color: '#ec4899',
    items: [
      ['ថ្នាំដុសធ្មេញ', 'Toothpaste', '100 ml', 299, null, 35, '🪥', 'ថ្នាំដុសធ្មេញក្លិនជីអង្កាម ដង្ហើមស្រស់។', 'Fresh mint toothpaste.', 'dental'],
      ['សាប៊ូកក់សក់', 'Shampoo', '400 ml', 499, null, 25, '🧴', 'សាប៊ូកក់សក់ស្រាល សម្រាប់គ្រប់ប្រភេទសក់។', 'Gentle shampoo for all hair types.', 'hair'],
      ['សាប៊ូលាងដៃ', 'Hand Soap', '250 ml', 249, null, 30, '🧼', 'សាប៊ូលាងដៃរាវ ធ្វើឱ្យស្បែកទន់រលោង។', 'Moisturising liquid hand soap.', 'soap'],
      ['ឡេការពារកម្តៅថ្ងៃ', 'Sunscreen SPF 50', '200 ml', 999, 1199, 15, '☀️', 'ឡេការពារកម្តៅថ្ងៃ SPF 50 ធន់នឹងទឹក។', 'Water-resistant SPF 50 sun lotion.', 'sun skin'],
      ['ក្រែមលាបបបូរមាត់', 'Lip Balm', '4.8 g', 179, null, 40, '💄', 'ក្រែមលាបបបូរមាត់ ការពារបបូរមាត់ស្ងួត។', 'Nourishing lip balm.', 'lips'],
    ],
  },
];

const LEVELS = [
  { name: 'ពន្លក', nameEn: 'Sprout', emoji: '🌱', minPoints: 0, multiplierPercent: 100, color: '#22c55e' },
  { name: 'ស្លឹកខៀវ', nameEn: 'Leaf', emoji: '🌿', minPoints: 300, multiplierPercent: 110, color: '#16a34a' },
  { name: 'ផ្កាឈូករ័ត្ន', nameEn: 'Sunflower', emoji: '🌻', minPoints: 800, multiplierPercent: 125, color: '#eab308' },
  { name: 'ដើមឈើធំ', nameEn: 'Mighty Oak', emoji: '🌳', minPoints: 2000, multiplierPercent: 150, color: '#a16207' },
];

const WELCOME = {
  title: 'បញ្ចុះ 10% ស្វាគមន៍',
  titleEn: 'Welcome 10% off',
  description: 'អំណោយសម្រាប់កន្ត្រកដំបូង៖ បញ្ចុះ 10% (រហូតដល់ $5) សម្រាប់ការបញ្ជាទិញលើសពី $15។',
  descriptionEn: 'Your first-basket thank-you: 10% off (up to $5) on orders over $15.',
  discountType: 'percent' as const,
  value: 10,
  maxDiscountCents: 500,
  minSubtotalCents: 1500,
  perCustomerLimit: null,
};

type Benefit = Partial<typeof coupons.$inferInsert> & { discountType: 'percent' | 'fixed' | 'free_delivery' | 'free_product' };
interface Milestone {
  points: number;
  emoji: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  benefit: Benefit;
  isSurprise?: boolean;
}

const FREE_DELIVERY: Milestone = {
  points: 100, emoji: '🚚', title: 'ដឹកជញ្ជូនឥតគិតថ្លៃ', titleEn: 'Free delivery',
  description: 'ការដឹកជញ្ជូនលើកក្រោយ យើងចេញថ្លៃជូន។', descriptionEn: 'Your next delivery is on us.',
  benefit: { discountType: 'free_delivery' },
};
const FIVE_OFF: Milestone = {
  points: 500, emoji: '💵', title: 'បញ្ចុះ $5', titleEn: '$5 off your basket',
  description: 'បញ្ចុះ $5 សម្រាប់ការបញ្ជាទិញចាប់ពី $25។', descriptionEn: '$5 off any order of $25 or more.',
  benefit: { discountType: 'fixed', value: 500, minSubtotalCents: 2500 },
};

async function insertMilestone(m: Milestone) {
  const [c] = await db
    .insert(coupons)
    .values({ title: m.title, titleEn: m.titleEn, description: m.description, descriptionEn: m.descriptionEn, perCustomerLimit: null, ...m.benefit })
    .returning();
  await db.insert(rewards).values({
    title: m.title, titleEn: m.titleEn, description: m.description, descriptionEn: m.descriptionEn,
    emoji: m.emoji, pointsRequired: m.points, couponId: c.id, isSurprise: !!m.isSurprise,
  });
}

async function insertBaseSettings(extra: Partial<typeof shopSettings.$inferInsert> = {}) {
  await db.insert(shopSettings).values({ id: 1 }).onConflictDoNothing();
  await db.update(shopSettings).set({
    shopName: 'mart25',
    tagline: 'ទំនិញស្រស់ ពិន្ទុរង្វាន់រាល់ការទិញ',
    taglineEn: 'Fresh groceries, rewards on every basket',
    currency: 'USD',
    deliveryFeeCents: 150,
    minOrderCents: 500,
    pickupHours: '7:00 – 21:00',
    pointsPerDollar: 1,
    signupBonusPoints: 50,
    rewardExpiryDays: 90,
    cashEnabled: true,
    qrPaymentMode: 'off',
    // mart25's store — the server resolves this link to coordinates on start-up (see services/geo.ts).
    storeMapsUrl: 'https://maps.app.goo.gl/1oWhhoUpnBVtErKN8',
    ...extra,
  }).where(eq(shopSettings.id, 1));
  await db.insert(levels).values(LEVELS).onConflictDoNothing();
  const [welcome] = await db.insert(coupons).values(WELCOME).returning();
  await db.update(shopSettings).set({ welcomeCouponId: welcome.id }).where(eq(shopSettings.id, 1));
}

/**
 * Production starter: shop settings, levels, a welcome coupon, milestone rewards and the aisles —
 * no products, customers or orders. Safe to run repeatedly (does nothing once aisles exist).
 */
export async function seedStarter(log: (m: string) => void = console.log) {
  // First boot only. Judged by the shop settings row, not by categories: an admin may delete every
  // category later, and that must never bring the starter aisles back.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(shopSettings);
  if (n > 0) return false;
  log('🌱 First boot: creating the mart25 starter setup (settings, levels, rewards, aisles)…');
  await insertBaseSettings();
  for (const m of [
    FREE_DELIVERY,
    { points: 250, emoji: '🎁', title: 'បញ្ចុះ $3', titleEn: '$3 off your basket', description: 'បញ្ចុះ $3 សម្រាប់ការបញ្ជាទិញចាប់ពី $15។', descriptionEn: '$3 off any order of $15 or more.', benefit: { discountType: 'fixed' as const, value: 300, minSubtotalCents: 1500 } },
    FIVE_OFF,
    { points: 1000, emoji: '🏆', title: 'បញ្ចុះ $10', titleEn: '$10 off your basket', description: 'បញ្ចុះ $10 សម្រាប់ការបញ្ជាទិញចាប់ពី $40។', descriptionEn: '$10 off any order of $40 or more.', benefit: { discountType: 'fixed' as const, value: 1000, minSubtotalCents: 4000 } },
  ]) {
    await insertMilestone(m);
  }
  let sort = 0;
  for (const cat of CATALOG) {
    await db.insert(categories).values({ name: cat.name, nameEn: cat.nameEn, slug: cat.slug, emoji: cat.emoji, color: cat.color, sortOrder: sort++ });
  }
  log('✅ Starter setup ready. Next: Dashboard → Settings (pickup address, fees) and Catalog (add products).');
  return true;
}

// Deterministic pseudo-random so every demo seed looks the same.
let s = 42;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const choose = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

export async function seedDemo() {
  setAutoDispatch(false);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(categories);
  if (n > 0) {
    console.log('ℹ️  Database already has data — run `npm run db:reset` for a fresh seed.');
    return;
  }

  console.log('🌱 Seeding mart25 settings & catalog…');
  // Demo pin in central Phnom Penh so the map and distance fees work locally without resolving the link.
  await insertBaseSettings({ pickupAddress: 'ហាង mart25 — បញ្ជរសេវាអតិថិជន', supportPhone: '+855 12 345 678', storeLat: 11.5564, storeLng: 104.9282 });

  const productIds: Record<string, number> = {};
  let sort = 0;
  for (const cat of CATALOG) {
    const [c] = await db.insert(categories).values({ name: cat.name, nameEn: cat.nameEn, slug: cat.slug, emoji: cat.emoji, color: cat.color, sortOrder: sort++ }).returning();
    for (const [name, nameEn, unit, price, compareAt, stock, emoji, description, descriptionEn, tags, featured] of cat.items) {
      const [p] = await db
        .insert(products)
        .values({ categoryId: c.id, name, nameEn, unit, priceCents: price, compareAtCents: compareAt, stock, emoji, description, descriptionEn, tags: `${tags ?? ''} ${nameEn}`.trim(), featured: !!featured })
        .returning();
      productIds[nameEn] = p.id;
      if (stock > 0) await db.insert(inventoryMovements).values({ productId: p.id, delta: stock, stockAfter: stock, reason: 'initial', note: 'Seed' });
    }
  }

  console.log('🎁 Seeding loyalty programme…');
  await db.insert(coupons).values([
    { code: 'FRESH5', title: 'បញ្ចុះ $5 សម្រាប់ការទិញលើស $40', titleEn: '$5 off orders over $40', description: 'ទិញច្រើន សន្សំច្រើន។ ប្រើបានម្តងក្នុងម្នាក់។', descriptionEn: 'Stock up and save. One use per customer.', discountType: 'fixed', value: 500, minSubtotalCents: 4000, perCustomerLimit: 1, maxRedemptions: 500, isPublic: true },
    { code: 'MART15', title: 'បញ្ចុះ 15% សម្រាប់កន្ត្រកធំ', titleEn: '15% off big baskets', description: 'បញ្ចុះ 15% (រហូតដល់ $10) ពេលទិញចាប់ពី $60។', descriptionEn: '15% off (up to $10) when you spend $60 or more.', discountType: 'percent', value: 15, maxDiscountCents: 1000, minSubtotalCents: 6000, perCustomerLimit: 2, isPublic: true },
  ]);
  await insertMilestone(FREE_DELIVERY);
  await insertMilestone({
    points: 250, emoji: '🍫', title: 'អំណោយភ្ញាក់ផ្អើល', titleEn: 'Surprise gift', isSurprise: true,
    description: 'សូកូឡាខ្មៅ 70% មួយដុំ ឥតគិតថ្លៃ ជាមួយការបញ្ជាទិញបន្ទាប់!', descriptionEn: 'A free bar of our 70% dark chocolate with your next order!',
    benefit: { discountType: 'free_product', freeProductId: productIds['Dark Chocolate 70%'] },
  });
  await insertMilestone(FIVE_OFF);
  await insertMilestone({
    points: 1000, emoji: '☕', title: 'កាហ្វេឥតគិតថ្លៃ', titleEn: 'Free coffee',
    description: 'កាហ្វេម៉ត់មួយកញ្ចប់ ឥតគិតថ្លៃ។', descriptionEn: 'A free bag of our ground coffee.',
    benefit: { discountType: 'free_product', freeProductId: productIds['Ground Coffee'] },
  });

  console.log('👥 Seeding demo customers via the real onboarding flow…');
  await db.insert(users).values({ telegramId: 100000009, firstName: 'Dara', lastName: 'Sok', username: 'dara_mart25', role: 'admin', privacyAcceptedAt: new Date(), signupSource: 'admin', phone: '+85512000009', languageCode: 'km' });

  const people = [
    { telegramId: 100000001, firstName: 'Sophea', lastName: 'Chan', username: 'sophea_dev', phone: '+85512000001', source: 'store', lang: 'km' },
    { telegramId: 100000002, firstName: 'Rithy', lastName: 'Kim', username: 'rithy_k', phone: '+85512000002', source: 'receipt', lang: 'km' },
    { telegramId: 100000003, firstName: 'Chenda', lastName: 'Long', username: null, phone: '+85512000003', source: 'store', lang: 'km' },
    { telegramId: 100000004, firstName: 'Visal', lastName: 'Heng', username: 'visalh', phone: '+85512000004', source: 'receipt', lang: 'km' },
    { telegramId: 100000005, firstName: 'Emma', lastName: 'Novak', username: 'emma_n', phone: '+85512000005', source: 'flyer', lang: 'en' },
    { telegramId: 100000006, firstName: 'Sreymom', lastName: 'Ouk', username: null, phone: '+85512000006', source: 'store', lang: 'km' },
  ];
  const created = [];
  for (const p of people) {
    const r = await completeOnboarding(
      { telegramId: p.telegramId, firstName: p.firstName, lastName: p.lastName, username: p.username, photoUrl: null, languageCode: p.lang, startParam: p.source },
      { firstName: p.firstName, lastName: p.lastName, phone: p.phone, acceptPrivacy: true, languageCode: p.lang },
    );
    created.push(r.user);
  }

  console.log('🧾 Seeding order history through checkout…');
  const admin = (await db.select().from(users).where(eq(users.telegramId, 100000009)))[0];
  const everyday = Object.keys(productIds).filter((k) => k !== 'Broccoli');
  const addr = { label: 'Home', line1: '', city: 'ភ្នំពេញ', postalCode: null, instructions: 'ចុចកណ្តឹងពីរដង', save: true };
  const streets = ['ផ្ទះ 48 ផ្លូវ 63', 'ផ្ទះ 7 ផ្លូវ 310', 'ផ្ទះ 102 ផ្លូវ 271', 'ផ្ទះ 15 ផ្លូវ 51', 'ផ្ទះ 230 ផ្លូវ 2004', 'ផ្ទះ 9 ផ្លូវ 450'];

  const plan: { who: number; daysAgo: number; final: OrderStatus; type: FulfillmentType; pay?: 'paid' | 'refunded' }[] = [];
  for (let d = 13; d >= 1; d--) {
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const type: FulfillmentType = rand() < 0.65 ? 'delivery' : 'pickup';
      const roll = rand();
      plan.push({ who: 1 + Math.floor(rand() * 5), daysAgo: d, type, final: roll < 0.1 ? 'cancelled' : type === 'delivery' ? 'delivered' : 'collected', pay: roll > 0.97 ? 'refunded' : 'paid' });
    }
  }
  // Sophea: two completed orders so her Rewards page is lively; plus today's active orders for the dashboard.
  plan.push({ who: 0, daysAgo: 6, type: 'delivery', final: 'delivered', pay: 'paid' }, { who: 0, daysAgo: 2, type: 'pickup', final: 'collected', pay: 'paid' });
  plan.push(
    { who: 2, daysAgo: 3, type: 'delivery', final: 'cancelled' },
    { who: 3, daysAgo: 0, type: 'pickup', final: 'ready_for_pickup' },
    { who: 4, daysAgo: 0, type: 'delivery', final: 'preparing' },
    { who: 2, daysAgo: 0, type: 'delivery', final: 'confirmed' },
    { who: 5, daysAgo: 0, type: 'delivery', final: 'placed' },
    { who: 1, daysAgo: 0, type: 'pickup', final: 'placed' },
  );

  for (const step of plan) {
    const user = (await db.select().from(users).where(eq(users.id, created[step.who].id)))[0];
    const lines = new Map<number, number>();
    const count = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const id = productIds[choose(everyday)];
      lines.set(id, Math.min(3, (lines.get(id) ?? 0) + 1));
    }
    let result;
    try {
      result = await placeOrder(user, {
        items: [...lines.entries()].map(([productId, quantity]) => ({ productId, quantity })),
        fulfillmentType: step.type,
        idempotencyKey: randomUUID(),
        paymentMethod: 'cash',
        contactName: `${user.firstName} ${user.lastName ?? ''}`.trim(),
        contactPhone: user.phone ?? '+85512000000',
        address: step.type === 'delivery' ? { ...addr, line1: streets[step.who] } : null,
        // Pins scattered 1–6 km around the demo store; one in three customers is happy to wait until tomorrow.
        location: step.type === 'delivery' ? { lat: 11.5564 + (rand() - 0.5) * 0.08, lng: 104.9282 + (rand() - 0.5) * 0.08 } : null,
        deliverySpeed: step.type === 'delivery' && rand() < 0.33 ? 'next_day' : 'same_day',
        note: rand() < 0.25 ? choose(['សូមរើសផ្លែបឺរទុំៗ 🙏', 'ទុកនៅមុខទ្វារ', 'ទូរស័ព្ទមកពេលមកដល់', 'មិនប្រើថង់ប្លាស្ទិក']) : null,
      });
    } catch (err) {
      console.log(`   (skipped a random basket: ${(err as Error).message})`);
      continue; // e.g. something sold out or below the minimum order — skip
    }
    const orderId = result.orderId;
    const flow = step.type === 'delivery' ? DELIVERY_FLOW : PICKUP_FLOW;
    if (step.final === 'cancelled') {
      await changeOrderStatus({ orderId, to: 'cancelled', actor: admin, reason: choose(['អតិថិជនស្នើសុំ', 'ទំនិញអស់ពីស្តុក']) });
    } else {
      for (const st of flow.slice(1, flow.indexOf(step.final) + 1)) {
        if (st === 'delivered' || st === 'collected') await changePaymentStatus({ orderId, to: 'paid', actor: admin });
        await changeOrderStatus({ orderId, to: st, actor: admin });
      }
      if (step.pay === 'refunded' && (step.final === 'delivered' || step.final === 'collected')) {
        await changePaymentStatus({ orderId, to: 'refunded', actor: admin, note: 'ទំនិញខូច — សងប្រាក់វិញទាំងអស់' });
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
  const sophea = (await db.select().from(users).where(eq(users.telegramId, 100000001)))[0];
  console.log(`✅ Seeded ${Object.keys(productIds).length} products, ${people.length} customers, ${orderCount} orders. Sophea has ${sophea.pointsBalance} points.`);
  console.log('   Dev logins: "Sophea (returning customer)", "Dara (shop admin)", or "New customer" for onboarding.');
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
