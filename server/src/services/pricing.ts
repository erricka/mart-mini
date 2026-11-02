/**
 * Pure pricing engine — no database access, fully unit-tested.
 * The same function is used for the live checkout quote and for the final order inside the
 * order transaction, so what the customer sees is exactly what gets charged.
 */
import type { FulfillmentType } from '../db/schema.js';
import { formatMoney } from '../lib/format.js';

export interface PricingProduct {
  id: number;
  name: string;
  unit: string;
  emoji: string;
  imageUrl: string | null;
  priceCents: number;
  stock: number;
  active: boolean;
}

export interface PricingCoupon {
  id: number;
  title: string;
  code: string | null;
  discountType: 'percent' | 'fixed' | 'free_delivery' | 'free_product';
  value: number;
  freeProductId: number | null;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}

export interface PricingSettings {
  currency: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number | null;
  minOrderCents: number;
  pointsPerDollar: number;
}

export type LineIssue = 'unavailable' | 'out_of_stock' | 'insufficient_stock';

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
  issue: LineIssue | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  itemDiscountCents: number;
  baseDeliveryFeeCents: number;
  deliveryDiscountCents: number;
  /** itemDiscount + deliveryDiscount */
  discountCents: number;
  totalCents: number;
  discount: { couponId: number; label: string; type: PricingCoupon['discountType'] } | null;
  couponError: string | null;
  pointsEstimate: number;
  freeDeliveryRemainingCents: number | null;
  minOrderRemainingCents: number;
  /** Problems that block placing the order. */
  issues: string[];
  canPlace: boolean;
}

export interface QuoteInput {
  lines: { product: PricingProduct; quantity: number }[];
  fulfillment: FulfillmentType;
  settings: PricingSettings;
  coupon?: PricingCoupon | null;
  /** Rewards from the customer's wallet ignore the coupon's public date window (they have their own expiry). */
  couponFromWallet?: boolean;
  giftProduct?: PricingProduct | null;
  multiplierPercent: number;
  now: Date;
}

/** Returns a human-readable reason the coupon can't be used, or null when it is valid. */
export function couponBlocker(
  coupon: PricingCoupon,
  subtotalCents: number,
  now: Date,
  currency: string,
  fromWallet = false,
): string | null {
  if (!fromWallet) {
    if (!coupon.active) return 'This coupon is no longer active.';
    if (coupon.startsAt && coupon.startsAt > now) return 'This coupon is not active yet.';
    if (coupon.endsAt && coupon.endsAt < now) return 'This coupon has expired.';
  }
  if (subtotalCents < coupon.minSubtotalCents) {
    return `Add ${formatMoney(coupon.minSubtotalCents - subtotalCents, currency)} more to use this coupon.`;
  }
  return null;
}

export function calculateQuote(input: QuoteInput): Quote {
  const { settings, fulfillment, now } = input;
  const issues: string[] = [];

  // Merge duplicate product lines defensively.
  const merged = new Map<number, { product: PricingProduct; quantity: number }>();
  for (const l of input.lines) {
    const prev = merged.get(l.product.id);
    merged.set(l.product.id, { product: l.product, quantity: (prev?.quantity ?? 0) + l.quantity });
  }

  const lines: QuoteLine[] = [];
  let subtotalCents = 0;
  for (const { product, quantity } of merged.values()) {
    let issue: LineIssue | null = null;
    if (!product.active) issue = 'unavailable';
    else if (product.stock <= 0) issue = 'out_of_stock';
    else if (quantity > product.stock) issue = 'insufficient_stock';
    if (issue) {
      issues.push(
        issue === 'insufficient_stock'
          ? `Only ${product.stock} × ${product.name} left in stock.`
          : `${product.name} is ${issue === 'unavailable' ? 'no longer available' : 'out of stock'}.`,
      );
    }
    const lineTotalCents = product.priceCents * quantity;
    subtotalCents += lineTotalCents;
    lines.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      emoji: product.emoji,
      imageUrl: product.imageUrl,
      unitPriceCents: product.priceCents,
      quantity,
      lineTotalCents,
      isGift: false,
      available: product.active ? Math.max(product.stock, 0) : 0,
      issue,
    });
  }

  if (lines.length === 0) issues.push('Your cart is empty.');

  if (fulfillment === 'delivery' && !settings.deliveryEnabled) issues.push('Delivery is currently unavailable.');
  if (fulfillment === 'pickup' && !settings.pickupEnabled) issues.push('Pickup is currently unavailable.');

  const minOrderRemainingCents = Math.max(0, settings.minOrderCents - subtotalCents);
  if (lines.length > 0 && minOrderRemainingCents > 0) {
    issues.push(`Minimum order is ${formatMoney(settings.minOrderCents, settings.currency)}.`);
  }

  // Delivery fee (before coupons). Free-delivery threshold uses the pre-discount subtotal.
  let baseDeliveryFeeCents = 0;
  let freeDeliveryRemainingCents: number | null = null;
  if (fulfillment === 'delivery') {
    if (settings.freeDeliveryMinCents != null && subtotalCents >= settings.freeDeliveryMinCents) {
      baseDeliveryFeeCents = 0;
      freeDeliveryRemainingCents = 0;
    } else {
      baseDeliveryFeeCents = settings.deliveryFeeCents;
      freeDeliveryRemainingCents =
        settings.freeDeliveryMinCents != null ? settings.freeDeliveryMinCents - subtotalCents : null;
    }
  }

  // Coupon / reward.
  let itemDiscountCents = 0;
  let deliveryDiscountCents = 0;
  let discount: Quote['discount'] = null;
  let couponError: string | null = null;
  const coupon = input.coupon ?? null;
  if (coupon) {
    couponError = couponBlocker(coupon, subtotalCents, now, settings.currency, input.couponFromWallet);
    if (!couponError) {
      switch (coupon.discountType) {
        case 'percent': {
          const pct = Math.min(Math.max(coupon.value, 0), 100);
          itemDiscountCents = Math.floor((subtotalCents * pct) / 100);
          if (coupon.maxDiscountCents != null) itemDiscountCents = Math.min(itemDiscountCents, coupon.maxDiscountCents);
          break;
        }
        case 'fixed':
          itemDiscountCents = Math.min(coupon.value, subtotalCents);
          break;
        case 'free_delivery':
          if (fulfillment !== 'delivery') couponError = 'Free delivery only applies to delivery orders.';
          else if (baseDeliveryFeeCents === 0) couponError = 'Your order already has free delivery — save this one!';
          else deliveryDiscountCents = baseDeliveryFeeCents;
          break;
        case 'free_product': {
          const gift = input.giftProduct;
          const inCart = gift ? (merged.get(gift.id)?.quantity ?? 0) : 0;
          if (!gift || !gift.active) couponError = 'This gift is not available right now.';
          else if (gift.stock - inCart < 1) couponError = `Sorry, the gift (${gift.name}) is out of stock.`;
          else {
            lines.push({
              productId: gift.id,
              name: gift.name,
              unit: gift.unit,
              emoji: gift.emoji,
              imageUrl: gift.imageUrl,
              unitPriceCents: 0,
              quantity: 1,
              lineTotalCents: 0,
              isGift: true,
              available: gift.stock,
              issue: null,
            });
          }
          break;
        }
      }
      if (!couponError) discount = { couponId: coupon.id, label: coupon.title, type: coupon.discountType };
    }
  }

  const discountCents = itemDiscountCents + deliveryDiscountCents;
  const totalCents = Math.max(0, subtotalCents - itemDiscountCents + baseDeliveryFeeCents - deliveryDiscountCents);

  // Points: merchandise value after item discounts, delivery excluded.
  const merchandiseCents = subtotalCents - itemDiscountCents;
  const pointsEstimate = Math.max(
    0,
    Math.floor((merchandiseCents * settings.pointsPerDollar * input.multiplierPercent) / 10000),
  );

  return {
    lines,
    subtotalCents,
    itemDiscountCents,
    baseDeliveryFeeCents,
    deliveryDiscountCents,
    discountCents,
    totalCents,
    discount,
    couponError,
    pointsEstimate,
    freeDeliveryRemainingCents,
    minOrderRemainingCents,
    issues,
    canPlace: issues.length === 0,
  };
}
