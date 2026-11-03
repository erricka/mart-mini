/**
 * Pure pricing engine — no database access, fully unit-tested.
 * The same function is used for the live checkout quote and for the final order inside the
 * order transaction, so what the customer sees is exactly what gets charged.
 */
import type { FulfillmentType } from '../db/schema.js';
import { formatMoney } from '../lib/format.js';
import { roadKm, type LatLng } from '../lib/geo.js';
import { tr } from '../lib/i18n.js';

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
  /** Flat fee: used in 'flat' mode, and in 'distance' mode until the store pin is known. */
  deliveryFeeCents: number;
  freeDeliveryMinCents: number | null;
  minOrderCents: number;
  pointsPerDollar: number;
  deliveryPricing: string;
  storeLat: number | null;
  storeLng: number | null;
  deliveryBaseCents: number;
  deliveryPerKmCents: number;
  deliveryMinFeeCents: number;
  deliveryMaxKm: number | null;
  nextDayEnabled: boolean;
  nextDayFeeCents: number;
}

export type DeliverySpeed = 'same_day' | 'next_day';

export interface DeliveryOptions {
  mode: 'flat' | 'distance';
  /** Estimated road km from the store (distance mode with a pin). */
  distanceKm: number | null;
  /** Distance mode but the customer hasn't dropped a pin yet. */
  needsLocation: boolean;
  tooFar: boolean;
  maxKm: number | null;
  /** Fees before the free-delivery threshold / coupons. Null when unknown or unavailable. */
  sameDayFeeCents: number | null;
  nextDayFeeCents: number | null;
}

export interface DeliveryInfo extends DeliveryOptions {
  speed: DeliverySpeed;
  /** The free-delivery threshold was reached, so the fee is 0 whichever speed is chosen. */
  freeByThreshold: boolean;
}

const roundUp = (cents: number, currency: string) => {
  const step = currency === 'KHR' ? 10_000 : 5; // 100៛ or 5¢
  return Math.ceil(cents / step) * step;
};

/**
 * Distance-based delivery pricing: base fare + per-km rate on the estimated road distance, with a
 * minimum fee, rounded up to a friendly amount. "Tomorrow" is a flat fee, never more than today.
 */
export function deliveryOptions(settings: PricingSettings, destination: LatLng | null): DeliveryOptions {
  const store = settings.storeLat != null && settings.storeLng != null ? { lat: settings.storeLat, lng: settings.storeLng } : null;
  const nextDay = (sameDay: number | null) =>
    settings.nextDayEnabled ? (sameDay == null ? settings.nextDayFeeCents : Math.min(settings.nextDayFeeCents, sameDay)) : null;
  if (settings.deliveryPricing !== 'distance' || !store) {
    return {
      mode: 'flat',
      distanceKm: store && destination ? roadKm(store, destination) : null,
      needsLocation: false,
      tooFar: false,
      maxKm: null,
      sameDayFeeCents: settings.deliveryFeeCents,
      nextDayFeeCents: nextDay(settings.deliveryFeeCents),
    };
  }
  const base = { mode: 'distance' as const, maxKm: settings.deliveryMaxKm };
  if (!destination) {
    return { ...base, distanceKm: null, needsLocation: true, tooFar: false, sameDayFeeCents: null, nextDayFeeCents: null };
  }
  const km = roadKm(store, destination);
  if (settings.deliveryMaxKm != null && km > settings.deliveryMaxKm) {
    return { ...base, distanceKm: km, needsLocation: false, tooFar: true, sameDayFeeCents: null, nextDayFeeCents: null };
  }
  const sameDay = roundUp(Math.max(settings.deliveryMinFeeCents, settings.deliveryBaseCents + settings.deliveryPerKmCents * km), settings.currency);
  return { ...base, distanceKm: km, needsLocation: false, tooFar: false, sameDayFeeCents: sameDay, nextDayFeeCents: nextDay(sameDay) };
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
  /** Delivery details (distance, speed, both fee options); null for pickup. */
  delivery: DeliveryInfo | null;
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
  /** Customer's map pin (delivery). */
  destination?: LatLng | null;
  deliverySpeed?: DeliverySpeed;
  /** When placing the order a pin is mandatory in distance mode; the cart preview doesn't need one. */
  requireLocation?: boolean;
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
    if (!coupon.active) return tr('price.coupon_inactive');
    if (coupon.startsAt && coupon.startsAt > now) return tr('price.coupon_not_started');
    if (coupon.endsAt && coupon.endsAt < now) return tr('price.coupon_expired');
  }
  if (subtotalCents < coupon.minSubtotalCents) {
    return tr('price.coupon_min', { amount: formatMoney(coupon.minSubtotalCents - subtotalCents, currency) });
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
          ? tr('price.only_left', { n: product.stock, name: product.name })
          : tr(issue === 'unavailable' ? 'price.unavailable' : 'price.out_of_stock', { name: product.name }),
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

  if (lines.length === 0) issues.push(tr('err.empty_cart'));

  if (fulfillment === 'delivery' && !settings.deliveryEnabled) issues.push(tr('price.no_delivery'));
  if (fulfillment === 'pickup' && !settings.pickupEnabled) issues.push(tr('price.no_pickup'));

  const minOrderRemainingCents = Math.max(0, settings.minOrderCents - subtotalCents);
  if (lines.length > 0 && minOrderRemainingCents > 0) {
    issues.push(tr('price.min_order', { amount: formatMoney(settings.minOrderCents, settings.currency) }));
  }

  // Delivery fee (before coupons). Free-delivery threshold uses the pre-discount subtotal.
  let baseDeliveryFeeCents = 0;
  let freeDeliveryRemainingCents: number | null = null;
  let delivery: DeliveryInfo | null = null;
  if (fulfillment === 'delivery') {
    const opts = deliveryOptions(settings, input.destination ?? null);
    const speed: DeliverySpeed = input.deliverySpeed ?? 'same_day';
    const freeByThreshold = settings.freeDeliveryMinCents != null && subtotalCents >= settings.freeDeliveryMinCents;
    delivery = { ...opts, speed, freeByThreshold };
    if (opts.needsLocation && input.requireLocation) issues.push(tr('price.need_location'));
    if (opts.tooFar) {
      issues.push(tr('price.too_far', { km: opts.distanceKm ?? 0, max: opts.maxKm ?? 0 }));
    } else if (speed === 'next_day' && opts.nextDayFeeCents == null && !opts.needsLocation) {
      issues.push(tr('price.next_day_off'));
    }
    if (freeByThreshold) {
      baseDeliveryFeeCents = 0;
      freeDeliveryRemainingCents = 0;
    } else {
      baseDeliveryFeeCents = (speed === 'next_day' ? opts.nextDayFeeCents : opts.sameDayFeeCents) ?? 0;
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
          if (fulfillment !== 'delivery') couponError = tr('price.fd_pickup');
          else if (delivery?.needsLocation) {
            /* Applied once the customer drops a pin and the fee is known. */
          } else if (baseDeliveryFeeCents === 0) couponError = tr('price.fd_already');
          else deliveryDiscountCents = baseDeliveryFeeCents;
          break;
        case 'free_product': {
          const gift = input.giftProduct;
          const inCart = gift ? (merged.get(gift.id)?.quantity ?? 0) : 0;
          if (!gift || !gift.active) couponError = tr('price.gift_unavailable');
          else if (gift.stock - inCart < 1) couponError = tr('price.gift_oos', { name: gift.name });
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
    delivery,
    issues,
    canPlace: issues.length === 0,
  };
}
