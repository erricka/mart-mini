import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------- Enums ----------
export const roleEnum = pgEnum('user_role', ['customer', 'staff', 'admin']);
export const fulfillmentEnum = pgEnum('fulfillment_type', ['delivery', 'pickup']);
export const orderStatusEnum = pgEnum('order_status', [
  'awaiting_payment',
  'placed',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'ready_for_pickup',
  'collected',
  'cancelled',
]);
export const paymentStatusEnum = pgEnum('payment_status', ['unpaid', 'paid', 'refunded', 'failed']);
export const paymentMethodEnum = pgEnum('payment_method', ['cash', 'qr']);
/** Reserved for a future online/QR payment integration (e.g. ABA PayWay). Not used yet — orders are cash only. */
export const qrPaymentModeEnum = pgEnum('qr_payment_mode', ['off', 'simulated', 'aba_payway']);
export const discountTypeEnum = pgEnum('discount_type', ['percent', 'fixed', 'free_delivery', 'free_product']);
export const customerRewardStatusEnum = pgEnum('customer_reward_status', ['available', 'used', 'revoked']);
export const customerRewardSourceEnum = pgEnum('customer_reward_source', ['milestone', 'welcome', 'manual']);
export const pointsTypeEnum = pgEnum('points_type', [
  'signup_bonus',
  'order_earn',
  'order_reversal',
  'manual_adjustment',
]);
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed', 'simulated']);
export const inventoryReasonEnum = pgEnum('inventory_reason', [
  'initial',
  'order',
  'cancel',
  'restock',
  'adjustment',
  'gift',
]);
export const redemptionStatusEnum = pgEnum('redemption_status', ['active', 'released']);

// ---------- Users ----------
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    username: text('username'),
    photoUrl: text('photo_url'),
    languageCode: text('language_code'),
    phone: text('phone'),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    role: roleEnum('role').notNull().default('customer'),
    pointsBalance: integer('points_balance').notNull().default(0),
    privacyAcceptedAt: ts('privacy_accepted_at'),
    signupSource: text('signup_source'),
    isBlocked: boolean('is_blocked').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [uniqueIndex('users_telegram_id_uq').on(t.telegramId), index('users_role_idx').on(t.role)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default('Home'),
    line1: text('line1').notNull(),
    line2: text('line2'),
    city: text('city').notNull(),
    postalCode: text('postal_code'),
    instructions: text('instructions'),
    /** Map pin chosen by the customer (used for the distance-based delivery fee). */
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

// ---------- Catalog ----------
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Optional English name; customers who chose English see it (falls back to `name`). */
  nameEn: text('name_en'),
  slug: text('slug').notNull().unique(),
  emoji: text('emoji').notNull().default('🛒'),
  color: text('color').notNull().default('#22c55e'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    /** Barcode / SKU — optional; used to match rows when re-importing a spreadsheet. */
    sku: text('sku'),
    description: text('description').notNull().default(''),
    descriptionEn: text('description_en'),
    unit: text('unit').notNull().default(''),
    priceCents: integer('price_cents').notNull(),
    /** Original price shown struck-through when the product is on promotion. */
    compareAtCents: integer('compare_at_cents'),
    stock: integer('stock').notNull().default(0),
    emoji: text('emoji').notNull().default('🛒'),
    imageUrl: text('image_url'),
    tags: text('tags').notNull().default(''),
    active: boolean('active').notNull().default(true),
    featured: boolean('featured').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('products_category_idx').on(t.categoryId),
    uniqueIndex('products_sku_uq').on(t.sku),
    check('products_stock_non_negative', sql`${t.stock} >= 0`),
    check('products_price_non_negative', sql`${t.priceCents} >= 0`),
  ],
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    delta: integer('delta').notNull(),
    stockAfter: integer('stock_after').notNull(),
    reason: inventoryReasonEnum('reason').notNull(),
    orderId: integer('order_id'),
    actorUserId: integer('actor_user_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('inventory_movements_product_idx').on(t.productId)],
);

// ---------- Settings & loyalty configuration ----------
export const shopSettings = pgTable(
  'shop_settings',
  {
    id: integer('id').primaryKey().default(1),
    shopName: text('shop_name').notNull().default('mart25'),
    tagline: text('tagline').notNull().default('ទំនិញស្រស់ ពិន្ទុរង្វាន់រាល់ការទិញ'),
    taglineEn: text('tagline_en'),
    currency: text('currency').notNull().default('USD'),
    deliveryEnabled: boolean('delivery_enabled').notNull().default(true),
    pickupEnabled: boolean('pickup_enabled').notNull().default(true),
    deliveryFeeCents: integer('delivery_fee_cents').notNull().default(299),
    /** Free delivery when the merchandise subtotal reaches this amount. Null = never free. */
    freeDeliveryMinCents: integer('free_delivery_min_cents'),
    minOrderCents: integer('min_order_cents').notNull().default(0),
    /**
     * 'distance' = fee by distance from the store to the customer's map pin (falls back to the flat
     * deliveryFeeCents while the store location is unknown); 'flat' = always deliveryFeeCents.
     */
    deliveryPricing: text('delivery_pricing').notNull().default('distance'),
    storeLat: doublePrecision('store_lat'),
    storeLng: doublePrecision('store_lng'),
    /** Google Maps link for the store; resolved to storeLat/storeLng by the server. */
    storeMapsUrl: text('store_maps_url'),
    // Default rates: KHR 1,500 base, 1,000/km, 2,500 minimum (at ~4,000៛/$).
    deliveryBaseCents: integer('delivery_base_cents').notNull().default(38),
    deliveryPerKmCents: integer('delivery_per_km_cents').notNull().default(25),
    deliveryMinFeeCents: integer('delivery_min_fee_cents').notNull().default(63),
    /** Farthest delivery distance in km (road estimate). Null = no limit. */
    deliveryMaxKm: integer('delivery_max_km').default(20),
    /** "I can wait until tomorrow" option with its own flat fee (never more than the same-day fee). */
    nextDayEnabled: boolean('next_day_enabled').notNull().default(true),
    nextDayFeeCents: integer('next_day_fee_cents').notNull().default(200),
    pickupAddress: text('pickup_address').notNull().default(''),
    pickupHours: text('pickup_hours').notNull().default(''),
    supportPhone: text('support_phone').notNull().default(''),
    pointsPerDollar: integer('points_per_dollar').notNull().default(1),
    signupBonusPoints: integer('signup_bonus_points').notNull().default(50),
    welcomeCouponId: integer('welcome_coupon_id'),
    /** Unlocked rewards expire after N days. Null = never. */
    rewardExpiryDays: integer('reward_expiry_days'),
    // Payments (QR fields reserved for a future online-payment integration; unused for now)
    cashEnabled: boolean('cash_enabled').notNull().default(true),
    qrPaymentMode: qrPaymentModeEnum('qr_payment_mode').notNull().default('simulated'),
    qrPaymentInstructions: text('qr_payment_instructions')
      .notNull()
      .default('Scan with ABA Mobile or any KHQR banking app, or tap "Open in ABA Mobile".'),
    /** Unpaid QR orders are cancelled (stock released) after this many minutes. */
    paymentWindowMinutes: integer('payment_window_minutes').notNull().default(30),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [check('shop_settings_singleton', sql`${t.id} = 1`)],
);

export const levels = pgTable('levels', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  nameEn: text('name_en'),
  emoji: text('emoji').notNull().default('⭐'),
  minPoints: integer('min_points').notNull().unique(),
  /** 100 = 1×, 125 = 1.25× points earned per purchase. */
  multiplierPercent: integer('multiplier_percent').notNull().default(100),
  color: text('color').notNull().default('#22c55e'),
  createdAt: createdAt(),
});

export const coupons = pgTable(
  'coupons',
  {
    id: serial('id').primaryKey(),
    /** Customer-enterable code. Null = can only be obtained as a reward / welcome gift. */
    code: text('code').unique(),
    title: text('title').notNull(),
    titleEn: text('title_en'),
    description: text('description').notNull().default(''),
    descriptionEn: text('description_en'),
    discountType: discountTypeEnum('discount_type').notNull(),
    /** Percent (1-100) for percent coupons, cents for fixed coupons. */
    value: integer('value').notNull().default(0),
    freeProductId: integer('free_product_id').references(() => products.id),
    minSubtotalCents: integer('min_subtotal_cents').notNull().default(0),
    maxDiscountCents: integer('max_discount_cents'),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    perCustomerLimit: integer('per_customer_limit').default(1),
    /** Listed for every customer in their "Available coupons". Requires a code. */
    isPublic: boolean('is_public').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('coupons_redeemed_non_negative', sql`${t.redeemedCount} >= 0`),
    check('coupons_value_non_negative', sql`${t.value} >= 0`),
  ],
);

/** Milestone rewards: reaching `pointsRequired` lifetime points unlocks `couponId` for the customer. */
export const rewards = pgTable('rewards', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  titleEn: text('title_en'),
  description: text('description').notNull().default(''),
  descriptionEn: text('description_en'),
  emoji: text('emoji').notNull().default('🎁'),
  pointsRequired: integer('points_required').notNull(),
  couponId: integer('coupon_id')
    .notNull()
    .references(() => coupons.id),
  /** Hide the coupon details until the reward is unlocked. */
  isSurprise: boolean('is_surprise').notNull().default(false),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** The customer's wallet of personal rewards (milestones, welcome coupon, manual gifts). */
export const customerRewards = pgTable(
  'customer_rewards',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rewardId: integer('reward_id').references(() => rewards.id),
    couponId: integer('coupon_id')
      .notNull()
      .references(() => coupons.id),
    source: customerRewardSourceEnum('source').notNull(),
    status: customerRewardStatusEnum('status').notNull().default('available'),
    unlockedAt: ts('unlocked_at').notNull().defaultNow(),
    usedAt: ts('used_at'),
    orderId: integer('order_id'),
    expiresAt: ts('expires_at'),
    seenAt: ts('seen_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    index('customer_rewards_user_idx').on(t.userId),
    // A milestone can be unlocked only once per customer.
    uniqueIndex('customer_rewards_user_reward_uq').on(t.userId, t.rewardId),
    // Only one welcome coupon per customer, ever.
    uniqueIndex('customer_rewards_one_welcome_uq').on(t.userId).where(sql`${t.source} = 'welcome'`),
  ],
);

/** One row per welcome grant; unique per account AND per phone number to stop repeated welcome rewards. */
export const welcomeGrants = pgTable('welcome_grants', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  phoneKey: text('phone_key').unique(),
  pointsGranted: integer('points_granted').notNull().default(0),
  createdAt: createdAt(),
});

// ---------- Orders ----------
export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    fulfillmentType: fulfillmentEnum('fulfillment_type').notNull(),
    status: orderStatusEnum('status').notNull().default('placed'),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentStatus: paymentStatusEnum('payment_status').notNull().default('unpaid'),
    subtotalCents: integer('subtotal_cents').notNull(),
    /** Total savings: item discount + delivery discount. */
    discountCents: integer('discount_cents').notNull().default(0),
    /** Delivery fee before any free-delivery coupon. */
    deliveryFeeCents: integer('delivery_fee_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    couponId: integer('coupon_id').references(() => coupons.id),
    customerRewardId: integer('customer_reward_id').references(() => customerRewards.id),
    discountLabel: text('discount_label'),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postalCode: text('postal_code'),
    addressInstructions: text('address_instructions'),
    deliveryLat: doublePrecision('delivery_lat'),
    deliveryLng: doublePrecision('delivery_lng'),
    /** Estimated road distance from the store, in km. */
    deliveryDistanceKm: doublePrecision('delivery_distance_km'),
    /** 'same_day' or 'next_day' (delivery orders only). */
    deliverySpeed: text('delivery_speed'),
    /** Promised delivery date (Cambodia time) for next-day orders. */
    deliveryDate: date('delivery_date', { mode: 'string' }),
    customerNote: text('customer_note'),
    cancelReason: text('cancel_reason'),
    cancelledBy: text('cancelled_by'),
    pointsEstimate: integer('points_estimate').notNull().default(0),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    pointsReversed: integer('points_reversed').notNull().default(0),
    placedAt: ts('placed_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    index('orders_status_idx').on(t.status),
    index('orders_user_idx').on(t.userId),
    index('orders_placed_at_idx').on(t.placedAt),
    check('orders_total_non_negative', sql`${t.totalCents} >= 0`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    nameEn: text('name_en'),
    unit: text('unit').notNull().default(''),
    emoji: text('emoji').notNull().default('🛒'),
    imageUrl: text('image_url'),
    unitPriceCents: integer('unit_price_cents').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalCents: integer('line_total_cents').notNull(),
    isGift: boolean('is_gift').notNull().default(false),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), check('order_items_qty_positive', sql`${t.quantity} > 0`)],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'status' | 'payment' | 'note'
    status: orderStatusEnum('status'),
    paymentStatus: paymentStatusEnum('payment_status'),
    note: text('note'),
    actorUserId: integer('actor_user_id'),
    actorRole: text('actor_role'),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // cash | simulated | aba_payway
  amountCents: integer('amount_cents').notNull(),
  status: paymentStatusEnum('status').notNull().default('unpaid'),
  providerRef: text('provider_ref'),
  /** Unguessable token for the public QR image / simulated-payment links. */
  checkoutToken: text('checkout_token').unique(),
  /** QR string returned by the provider (rendered as an image by /api/payments/qr/:token.png). */
  qrPayload: text('qr_payload'),
  /** Deep link into the payer's banking app (e.g. ABA Mobile) for customers paying on the same phone. */
  appLink: text('app_link'),
  /** Our transaction id sent to the provider (unique per merchant). */
  reference: text('reference'),
  expiresAt: ts('expires_at'),
  paidAt: ts('paid_at'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: serial('id').primaryKey(),
    couponId: integer('coupon_id')
      .notNull()
      .references(() => coupons.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    orderId: integer('order_id')
      .notNull()
      .unique()
      .references(() => orders.id),
    customerRewardId: integer('customer_reward_id'),
    discountCents: integer('discount_cents').notNull(),
    status: redemptionStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
    releasedAt: ts('released_at'),
  },
  (t) => [index('coupon_redemptions_coupon_user_idx').on(t.couponId, t.userId)],
);

/** Append-only points ledger. idempotency_key makes every award/reversal happen at most once. */
export const pointsTransactions = pgTable(
  'points_transactions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    type: pointsTypeEnum('type').notNull(),
    orderId: integer('order_id'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    note: text('note'),
    actorUserId: integer('actor_user_id'),
    createdAt: createdAt(),
  },
  (t) => [index('points_transactions_user_idx').on(t.userId, t.createdAt)],
);

// ---------- Messaging & staff access ----------
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id'),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    buttonText: text('button_text'),
    buttonPath: text('button_path'),
    status: notificationStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    orderId: integer('order_id'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('notifications_status_idx').on(t.status), index('notifications_order_idx').on(t.orderId)],
);

export const staffLoginTokens = pgTable('staff_login_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type ShopSettings = typeof shopSettings.$inferSelect;
export type Level = typeof levels.$inferSelect;
export type Reward = typeof rewards.$inferSelect;
export type CustomerReward = typeof customerRewards.$inferSelect;
export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type FulfillmentType = (typeof fulfillmentEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type QrPaymentMode = (typeof qrPaymentModeEnum.enumValues)[number];

// ---------- Uploaded images ----------
/**
 * Product photos live in the database (not on disk) so the app runs on hosts without a persistent
 * disk, e.g. free plans. Uploads are resized in the browser first, so rows stay small.
 */
export const media = pgTable('media', {
  /** "<uuid>.<ext>" — also the public path: /media/<id> */
  id: text('id').primaryKey(),
  contentType: text('content_type').notNull(),
  bytes: bytea('bytes').notNull(),
  size: integer('size').notNull(),
  createdAt: createdAt(),
});
