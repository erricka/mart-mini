export type Role = 'customer' | 'staff' | 'admin';
export type OrderStatus = 'placed' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'ready_for_pickup' | 'collected' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded' | 'failed';
export type PaymentMethod = 'cash';
export type Fulfillment = 'delivery' | 'pickup';
export type DiscountType = 'percent' | 'fixed' | 'free_delivery' | 'free_product';

export interface User {
  id: number;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  phone: string | null;
  phoneVerified: boolean;
  role: Role;
  pointsBalance: number;
  languageCode: string | null;
  createdAt: string;
}

export interface Shop {
  shopName: string;
  tagline: string;
  currency: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number | null;
  minOrderCents: number;
  pickupAddress: string;
  pickupHours: string;
  supportPhone: string;
  devLoginEnabled: boolean;
  telegramConfigured: boolean;
  notificationsSimulated: boolean;
  loyalty: {
    signupBonusPoints: number;
    pointsPerDollar: number;
    welcomeCoupon: CouponInfo | null;
    firstMilestone: { title: string; emoji: string; pointsRequired: number; benefit: string } | null;
  };
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  emoji: string;
  color: string;
  productCount: number;
}

export interface Product {
  id: number;
  categoryId: number;
  name: string;
  description: string;
  unit: string;
  priceCents: number;
  compareAtCents: number | null;
  discountPercent: number;
  stock: number;
  inStock: boolean;
  emoji: string;
  imageUrl: string | null;
  featured: boolean;
}

export interface CouponInfo {
  id: number;
  code: string | null;
  title: string;
  description: string;
  discountType: DiscountType;
  value: number;
  benefit: string;
  minSubtotalCents: number;
  endsAt: string | null;
}

export interface WalletItem {
  id: number;
  source: 'milestone' | 'welcome' | 'manual';
  status: 'available' | 'used' | 'revoked' | 'expired';
  title: string;
  emoji: string;
  unlockedAt: string;
  usedAt: string | null;
  orderId: number | null;
  expiresAt: string | null;
  seen: boolean;
  coupon: CouponInfo;
}

export interface Level {
  id: number;
  name: string;
  emoji: string;
  minPoints: number;
  multiplierPercent: number;
  color: string;
}

export interface Progress {
  title: string;
  emoji: string;
  pointsRequired: number;
  remaining: number;
  fromPoints: number;
  percent: number;
}

export interface RewardsOverview {
  balance: number;
  pointsPerDollar: number;
  level: Level;
  nextLevel: (Level & { remaining: number }) | null;
  levels: Level[];
  milestones: {
    id: number;
    title: string;
    description: string;
    emoji: string;
    pointsRequired: number;
    isSurprise: boolean;
    reached: boolean;
    benefit: string;
    walletStatus: WalletItem['status'] | null;
  }[];
  progress: Progress | null;
  wallet: WalletItem[];
  publicCoupons: CouponInfo[];
  unseen: WalletItem[];
  history: { id: number; delta: number; balanceAfter: number; type: string; orderId: number | null; note: string | null; createdAt: string }[];
  badges: { id: string; emoji: string; title: string; hint: string; earned: boolean }[];
  completedOrders: number;
}

export interface QuoteLine {
  productId: number;
  name: string;
  unit: string;
  emoji: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  isGift: boolean;
  available: number;
  issue: 'unavailable' | 'out_of_stock' | 'insufficient_stock' | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  itemDiscountCents: number;
  baseDeliveryFeeCents: number;
  deliveryDiscountCents: number;
  discountCents: number;
  totalCents: number;
  discount: { couponId: number; label: string; type: DiscountType } | null;
  couponError: string | null;
  pointsEstimate: number;
  freeDeliveryRemainingCents: number | null;
  minOrderRemainingCents: number;
  issues: string[];
  canPlace: boolean;
  missingProductIds: number[];
  level: { name: string; emoji: string; multiplierPercent: number };
}

export interface Address {
  id: number;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string | null;
  instructions: string | null;
  isDefault: boolean;
}

export interface TimelineStep {
  status: OrderStatus;
  label: string;
  done: boolean;
  current: boolean;
  at: string | null;
}

export interface OrderSummary {
  id: number;
  code: string;
  status: OrderStatus;
  statusLabel: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  fulfillmentType: Fulfillment;
  totalCents: number;
  itemCount: number | null;
  pointsEstimate: number;
  pointsAwarded: number;
  pointsReversed: number;
  placedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  contactName: string;
  preview?: string[];
}

export interface OrderDetail extends OrderSummary {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  discountLabel: string | null;
  contactPhone: string;
  address: { line1: string | null; line2: string | null; city: string | null; postalCode: string | null; instructions: string | null } | null;
  pickup: { address: string; hours: string } | null;
  customerNote: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  canCancel: boolean;
  items: {
    id: number;
    productId: number;
    name: string;
    unit: string;
    emoji: string;
    imageUrl: string | null;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
    isGift: boolean;
  }[];
  timeline: TimelineStep[];
  currency: string;
  supportPhone: string;
}

export interface StaffOrderDetail extends OrderDetail {
  allowedNext: OrderStatus[];
  allowedPayment: PaymentStatus[];
  events: { id: number; kind: string; status: OrderStatus | null; paymentStatus: PaymentStatus | null; note: string | null; actorRole: string | null; createdAt: string }[];
  customer: {
    id: number;
    name: string;
    username: string | null;
    telegramId: number;
    phone: string | null;
    phoneVerified: boolean;
    photoUrl: string | null;
    pointsBalance: number;
    orderCount: number;
  };
  notifications: { id: number; kind: string; status: 'pending' | 'sent' | 'failed' | 'simulated'; createdAt: string; lastError: string | null }[];
}
