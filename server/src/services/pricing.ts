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

/**
 * Where the delivery fee stands. Only `ok` has a fee; every other state means "no fee yet" — never $0
 * and never "free delivery".
 *  - needs_address: the customer hasn't given the location the calculator needs (first visit)
 *  - unsupported:   the location is outside the delivery area
 *  - unavailable:   delivery (or the chosen speed) is switched off
 */
export type DeliveryStatus = 'needs_address' | 'ok' | 'unsupported' | 'unavailable';

export interface DeliveryOptions {
  mode: 'flat' | 'distance';
  status: DeliveryStatus;
  /** Estimated road km from the store (when a pin is known). */
  distanceKm: number | null;
  maxKm: number | null;
  /** Standard fees for each speed (before free delivery / coupons). Null unless the location is ok. */
  sameDayFeeCents: number | null;
  nextDayFeeCents: number | null;
}

/** The shop's free-delivery rule, when one is configured (Settings → "Free delivery from"). */
export interface FreeDeliveryRule {
  type: 'min_subtotal';
  minCents: number;
  /** How much more the customer needs to spend (0 when met). */
  remainingCents: number;
  met: boolean;
}

export interface DeliveryInfo extends DeliveryOptions {
  speed: DeliverySpeed;
  /** Standard fee for the chosen speed, before free delivery / coupons. Null unless status is ok. */
  standardFeeCents: number | null;
  /** True only when the location is validated (status ok) AND the basket meets the rule. */
  freeDelivery: boolean;
  freeRule: FreeDeliveryRule | null;
  /** What the customer should do / why there's no fee (in their language). Null when ok. */
  message: string | null;
}

const roundUp = (cents: number, currency: string) => {
  const step = currency === 'KHR' ? 10_000 : 5; // 100៛ or 5¢
  return Math.ceil(cents / step) * step;
};

/**
 * Distance-based delivery pricing: base fare + per-km rate on the estimated road distance, with a
 * minimum fee, rounded up to a friendly amount. "Tomorrow" is a flat fee, never more than today.
 */
export function deliveryOptions(settings: PricingSettings, destination: LatLng | null, addressReady = false): DeliveryOptions {
  const store = settings.storeLat != null && settings.storeLng != null ? { lat: settings.storeLat, lng: settings.storeLng } : null;
  const nextDay = (sameDay: number) =>
    settings.nextDayEnabled ? Math.min(settings.nextDayFeeCents, sameDay) : null;
  const none = { sameDayFeeCents: null, nextDayFeeCents: null };
  if (settings.deliveryPricing !== 'distance' || !store) {
    // Flat fee: the calculator needs an address (typed or saved) — or a pin — before showing a fee.
    const base = { mode: 'flat' as const, maxKm: null, distanceKm: store && destination ? roadKm(store, destination) : null };
    if (!settings.deliveryEnabled) return { ...base, status: 'unavailable', ...none };
    if (!destination && !addressReady) return { ...base, status: 'needs_address', ...none };
    return { ...base, status: 'ok', sameDayFeeCents: settings.deliveryFeeCents, nextDayFeeCents: nextDay(settings.deliveryFeeCents) };
  }
  const base = { mode: 'distance' as const, maxKm: settings.deliveryMaxKm };
  if (!settings.deliveryEnabled) return { ...base, status: 'unavailable', distanceKm: null, ...none };
  // Distance pricing: the calculator needs the map pin.
  if (!destination) return { ...base, status: 'needs_address', distanceKm: null, ...none };
  const km = roadKm(store, destination);
  if (settings.deliveryMaxKm != null && km > settings.deliveryMaxKm) return { ...base, status: 'unsupported', distanceKm: km, ...none };
  const sameDay = roundUp(Math.max(settings.deliveryMinFeeCents, settings.deliveryBaseCents + settings.deliveryPerKmCents * km), settings.currency);
  return { ...base, status: 'ok', distanceKm: km, sameDayFeeCents: sameDay, nextDayFeeCents: nextDay(sameDay) };
}

/** The configured free-delivery rule for this basket, or null when Mart25 hasn't set one. */
export function freeDeliveryRule(settings: PricingSettings, subtotalCents: number): FreeDeliveryRule | null {
  if (settings.freeDeliveryMinCents == null) return null;
  const remainingCents = Math.max(0, settings.freeDeliveryMinCents - subtotalCents);
  return { type: 'min_subtotal', minCents: settings.freeDeliveryMinCents, remainingCents, met: remainingCents === 0 };
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
  /**
   * Delivery fee to charge before coupons: 0 for pickup or free delivery, the standard fee otherwise,
   * and NULL while there's no validated delivery location (see delivery.status) — never a fake $0.
   */
  baseDeliveryFeeCents: number | null;
  deliveryDiscountCents: number;
  /** itemDiscount + deliveryDiscount */
  discountCents: number;
  /** What the customer pays. While the delivery fee is pending this excludes delivery (see totalPending). */
  totalCents: number;
  /** True for delivery orders whose fee isn't known yet — the total isn't final. */
  totalPending: boolean;
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
  /** A delivery address (saved, or typed with street + city) is present — flat-fee mode needs it. */
  addressReady?: boolean;
  deliverySpeed?: DeliverySpeed;
  /** When placing the order a validated location is mandatory; the cart preview doesn't need one. */
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

  // Delivery fee (before coupons). The free-delivery rule uses the pre-discount subtotal, and only
  // applies once the delivery location is validated — a pending or unsupported location never shows
  // $0 or "free delivery".
  let baseDeliveryFeeCents: number | null = 0;
  let freeDeliveryRemainingCents: number | null = null;
  let delivery: DeliveryInfo | null = null;
  if (fulfillment === 'delivery') {
    const opts = deliveryOptions(settings, input.destination ?? null, input.addressReady ?? false);
    const speed: DeliverySpeed = input.deliverySpeed ?? 'same_day';
    let status = opts.status;
    let standardFeeCents: number | null = null;
    if (status === 'ok') {
      standardFeeCents = speed === 'next_day' ? opts.nextDayFeeCents : opts.sameDayFeeCents;
      if (standardFeeCents == null) status = 'unavailable'; // next-day switched off
    }
    const freeRule = freeDeliveryRule(settings, subtotalCents);
    const freeDelivery = status === 'ok' && !!freeRule?.met;
    const message =
      status === 'needs_address'
        ? tr('price.need_address')
        : status === 'unsupported'
          ? tr('price.too_far', { km: opts.distanceKm ?? 0, max: opts.maxKm ?? 0 })
          : status === 'unavailable'
            ? tr(settings.deliveryEnabled ? 'price.next_day_off' : 'price.no_delivery')
            : null;
    delivery = { ...opts, status, speed, standardFeeCents, freeDelivery, freeRule, message };
    // "Delivery off" is already listed above; a missing address only blocks placing the order.
    if (status === 'unsupported' || (status === 'unavailable' && settings.deliveryEnabled)) issues.push(message!);
    if (status === 'needs_address' && input.requireLocation) issues.push(message!);
    baseDeliveryFeeCents = status === 'ok' ? (freeDelivery ? 0 : standardFeeCents!) : null;
    freeDeliveryRemainingCents = freeRule ? freeRule.remainingCents : null;
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
          else if (baseDeliveryFeeCents == null) {
            /* Applied once the delivery location is validated and the fee is known. */
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
  const totalCents = Math.max(0, subtotalCents - itemDiscountCents + (baseDeliveryFeeCents ?? 0) - deliveryDiscountCents);
  const totalPending = baseDeliveryFeeCents == null;

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
    totalPending,
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
