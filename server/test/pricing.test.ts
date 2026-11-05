import { describe, expect, it } from 'vitest';
import { calculateQuote, type PricingCoupon, type PricingProduct, type PricingSettings } from '../src/services/pricing.js';

const settings: PricingSettings = {
  currency: 'USD',
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFeeCents: 299,
  freeDeliveryMinCents: 3500,
  minOrderCents: 1000,
  pointsPerDollar: 1,
  deliveryPricing: 'flat',
  storeLat: null,
  storeLng: null,
  deliveryBaseCents: 38,
  deliveryPerKmCents: 25,
  deliveryMinFeeCents: 63,
  deliveryMaxKm: 20,
  nextDayEnabled: true,
  nextDayFeeCents: 200,
};
const product = (id: number, priceCents: number, stock = 10, active = true): PricingProduct => ({
  id, name: `P${id}`, unit: '', emoji: '🛒', imageUrl: null, priceCents, stock, active,
});
const coupon = (over: Partial<PricingCoupon>): PricingCoupon => ({
  id: 1, title: 'C', code: null, discountType: 'percent', value: 10, freeProductId: null,
  minSubtotalCents: 0, maxDiscountCents: null, startsAt: null, endsAt: null, active: true, ...over,
});
const base = { settings, multiplierPercent: 100, now: new Date(), addressReady: true };

describe('pricing', () => {
  it('adds a delivery fee below the free-delivery threshold and tells how much is missing', () => {
    const q = calculateQuote({ ...base, lines: [{ product: product(1, 1200), quantity: 2 }], fulfillment: 'delivery' });
    expect(q.subtotalCents).toBe(2400);
    expect(q.baseDeliveryFeeCents).toBe(299);
    expect(q.totalCents).toBe(2699);
    expect(q.freeDeliveryRemainingCents).toBe(1100);
    expect(q.pointsEstimate).toBe(24);
  });

  it('gives free delivery at the threshold and never charges a fee for pickup', () => {
    expect(calculateQuote({ ...base, lines: [{ product: product(1, 3500), quantity: 1 }], fulfillment: 'delivery' }).baseDeliveryFeeCents).toBe(0);
    // Flat fee without any address yet: pending, not $0 — even above the threshold.
    const noAddress = calculateQuote({ ...base, addressReady: false, lines: [{ product: product(1, 3500), quantity: 1 }], fulfillment: 'delivery' });
    expect(noAddress.baseDeliveryFeeCents).toBeNull();
    expect(noAddress.delivery).toMatchObject({ status: 'needs_address', freeDelivery: false });
    expect(noAddress.totalPending).toBe(true);
    expect(calculateQuote({ ...base, lines: [{ product: product(1, 1500), quantity: 1 }], fulfillment: 'pickup' }).baseDeliveryFeeCents).toBe(0);
  });

  it('caps percent discounts and excludes delivery from points', () => {
    const q = calculateQuote({ ...base, lines: [{ product: product(1, 10000), quantity: 1 }], fulfillment: 'delivery', coupon: coupon({ value: 10, maxDiscountCents: 500 }) });
    expect(q.itemDiscountCents).toBe(500);
    expect(q.totalCents).toBe(9500);
    expect(q.pointsEstimate).toBe(95);
  });

  it('applies level multipliers to points', () => {
    const q = calculateQuote({ ...base, multiplierPercent: 125, lines: [{ product: product(1, 2000), quantity: 1 }], fulfillment: 'pickup' });
    expect(q.pointsEstimate).toBe(25);
  });

  it('enforces coupon minimum spend with a helpful message', () => {
    const q = calculateQuote({ ...base, lines: [{ product: product(1, 1200), quantity: 1 }], fulfillment: 'pickup', coupon: coupon({ discountType: 'fixed', value: 500, minSubtotalCents: 4000 }) });
    expect(q.discount).toBeNull();
    expect(q.couponError).toMatch(/Add \$28\.00 more/);
  });

  it('free-delivery coupon removes the fee, but is refused when delivery is already free', () => {
    const fd = coupon({ discountType: 'free_delivery' });
    const q1 = calculateQuote({ ...base, lines: [{ product: product(1, 1500), quantity: 1 }], fulfillment: 'delivery', coupon: fd });
    expect(q1.deliveryDiscountCents).toBe(299);
    expect(q1.totalCents).toBe(1500);
    const q2 = calculateQuote({ ...base, lines: [{ product: product(1, 4000), quantity: 1 }], fulfillment: 'delivery', coupon: fd });
    expect(q2.discount).toBeNull();
    expect(q2.couponError).toMatch(/already has free delivery/);
  });

  it('adds a free gift line, accounting for the same product already in the cart', () => {
    const gift = product(9, 279, 2);
    const ok = calculateQuote({ ...base, lines: [{ product: product(1, 1500), quantity: 1 }], fulfillment: 'pickup', coupon: coupon({ discountType: 'free_product', freeProductId: 9 }), giftProduct: gift });
    expect(ok.lines.find((l) => l.isGift)?.unitPriceCents).toBe(0);
    const soldOut = calculateQuote({ ...base, lines: [{ product: product(1, 1500), quantity: 1 }, { product: gift, quantity: 2 }], fulfillment: 'pickup', coupon: coupon({ discountType: 'free_product', freeProductId: 9 }), giftProduct: gift });
    expect(soldOut.couponError).toMatch(/out of stock/);
  });

  it('blocks out-of-stock, insufficient stock, inactive items and minimum order', () => {
    const q = calculateQuote({
      ...base,
      fulfillment: 'pickup',
      lines: [{ product: product(1, 100, 0), quantity: 1 }, { product: product(2, 100, 1), quantity: 3 }, { product: product(3, 100, 5, false), quantity: 1 }],
    });
    expect(q.canPlace).toBe(false);
    expect(q.lines.map((l) => l.issue)).toEqual(['out_of_stock', 'insufficient_stock', 'unavailable']);
    expect(q.issues.some((i) => i.startsWith('Minimum order'))).toBe(true);
  });
});
