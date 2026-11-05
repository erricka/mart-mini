import { describe, expect, it } from 'vitest';
import { cambodiaDate, coordsFromText, resolveMapsLink, roadKm } from '../src/lib/geo.js';
import { calculateQuote, deliveryOptions, type PricingProduct, type PricingSettings } from '../src/services/pricing.js';

const STORE = { lat: 11.5564, lng: 104.9282 };
const settings: PricingSettings = {
  currency: 'USD',
  deliveryEnabled: true,
  pickupEnabled: true,
  deliveryFeeCents: 150,
  freeDeliveryMinCents: 3500,
  minOrderCents: 0,
  pointsPerDollar: 1,
  deliveryPricing: 'distance',
  storeLat: STORE.lat,
  storeLng: STORE.lng,
  deliveryBaseCents: 38,
  deliveryPerKmCents: 25,
  deliveryMinFeeCents: 63,
  deliveryMaxKm: 20,
  nextDayEnabled: true,
  nextDayFeeCents: 200,
};
const product = (priceCents: number): PricingProduct => ({ id: 1, name: 'P', unit: '', emoji: '🛒', imageUrl: null, priceCents, stock: 50, active: true });
const quote = (over: Partial<Parameters<typeof calculateQuote>[0]> = {}) =>
  calculateQuote({ settings, multiplierPercent: 100, now: new Date(), lines: [{ product: product(1000), quantity: 1 }], fulfillment: 'delivery', ...over });
const north = (km: number) => ({ lat: STORE.lat + km / 111.2, lng: STORE.lng }); // straight-line km due north

describe('distance-based delivery fee', () => {
  it('estimates road distance as straight line × 1.3', () => {
    expect(roadKm(STORE, north(1))).toBeCloseTo(1.3, 1);
    expect(roadKm(STORE, north(10))).toBeCloseTo(13, 0);
  });

  it('charges base + per km on the road distance, rounded up to 5¢, with a minimum', () => {
    // 1 km straight → 1.3 km road → 38 + 25×1.3 = 70.5 → $0.75
    expect(deliveryOptions(settings, north(1)).sameDayFeeCents).toBe(75);
    // 6 km straight → 7.8 km road → 38 + 195 = 233 → $2.35
    expect(deliveryOptions(settings, north(6)).sameDayFeeCents).toBe(235);
    // Next door → the minimum fee ($0.63 → $0.65)
    expect(deliveryOptions(settings, north(0.05)).sameDayFeeCents).toBe(65);
  });

  it('offers "tomorrow" for a flat $2, but never more than today', () => {
    const far = deliveryOptions(settings, north(6));
    expect(far.nextDayFeeCents).toBe(200);
    const near = deliveryOptions(settings, north(1));
    expect(near.nextDayFeeCents).toBe(75);
    expect(deliveryOptions({ ...settings, nextDayEnabled: false }, north(6)).nextDayFeeCents).toBeNull();
  });

  it('uses the chosen speed in the quote and keeps the free-delivery threshold', () => {
    const today = quote({ destination: north(6) });
    expect(today.baseDeliveryFeeCents).toBe(235);
    expect(today.delivery).toMatchObject({ mode: 'distance', status: 'ok', speed: 'same_day', distanceKm: 7.8, standardFeeCents: 235, freeDelivery: false });
    const tomorrow = quote({ destination: north(6), deliverySpeed: 'next_day' });
    expect(tomorrow.baseDeliveryFeeCents).toBe(200);
    expect(tomorrow.totalCents).toBe(1200);
    const big = quote({ destination: north(6), deliverySpeed: 'next_day', lines: [{ product: product(4000), quantity: 1 }] });
    expect(big.baseDeliveryFeeCents).toBe(0);
    expect(big.delivery).toMatchObject({ freeDelivery: true, standardFeeCents: 200 });
  });
  it('rounds riel fees up to 100៛', () => {
    const khr = { ...settings, currency: 'KHR', deliveryBaseCents: 150_000, deliveryPerKmCents: 100_000, deliveryMinFeeCents: 250_000, nextDayFeeCents: 800_000 };
    // 1.3 km → 1,500 + 1,300 = 2,800៛
    expect(deliveryOptions(khr, north(1)).sameDayFeeCents).toBe(280_000);
  });

  it('applies a free-delivery reward to the tomorrow fee', () => {
    const q = quote({
      destination: north(6),
      deliverySpeed: 'next_day',
      coupon: { id: 9, title: 'Free delivery', code: null, discountType: 'free_delivery', value: 0, freeProductId: null, minSubtotalCents: 0, maxDiscountCents: null, startsAt: null, endsAt: null, active: true },
    });
    expect(q.deliveryDiscountCents).toBe(200);
    expect(q.totalCents).toBe(1000);
  });

  it('dates "tomorrow" in Cambodia time', () => {
    // 20:00 UTC on 3 Nov is already 03:00 on 4 Nov in Phnom Penh → tomorrow is 5 Nov.
    expect(cambodiaDate(new Date('2026-11-03T20:00:00Z'), 1)).toBe('2026-11-05');
    expect(cambodiaDate(new Date('2026-11-03T10:00:00Z'), 1)).toBe('2026-11-04');
  });
});

describe('Delivery fee scenarios (free delivery only after the location is validated)', () => {
  const big = (cents: number) => [{ product: product(cents), quantity: 1 }];

  it('first visit, no address: fee pending — never $0 and never "free", even above the threshold', () => {
    for (const lines of [big(1000), big(5000)]) {
      const q = quote({ lines });
      expect(q.delivery).toMatchObject({ status: 'needs_address', standardFeeCents: null, freeDelivery: false });
      expect(q.delivery?.message).toMatch(/Enter your delivery address/);
      expect(q.baseDeliveryFeeCents).toBeNull();
      expect(q.totalPending).toBe(true);
      expect(q.canPlace).toBe(true); // browsing is fine…
      expect(quote({ lines, requireLocation: true }).canPlace).toBe(false); // …placing the order is not
    }
  });

  it('valid address, below the threshold: standard fee, and how much more to spend', () => {
    const q = quote({ destination: north(6), lines: big(3000) });
    expect(q.baseDeliveryFeeCents).toBe(235);
    expect(q.totalCents).toBe(3235);
    expect(q.delivery?.freeRule).toEqual({ type: 'min_subtotal', minCents: 3500, remainingCents: 500, met: false });
  });

  it('exactly at the threshold: free delivery', () => {
    const q = quote({ destination: north(6), lines: big(3500) });
    expect(q.delivery).toMatchObject({ status: 'ok', freeDelivery: true, standardFeeCents: 235 });
    expect(q.baseDeliveryFeeCents).toBe(0);
    expect(q.totalCents).toBe(3500);
  });

  it('falling below the threshold after removing an item restores the standard fee', () => {
    const at = quote({ destination: north(6), lines: [{ product: product(1750), quantity: 2 }] });
    expect(at.baseDeliveryFeeCents).toBe(0);
    const after = quote({ destination: north(6), lines: [{ product: product(1750), quantity: 1 }] });
    expect(after.baseDeliveryFeeCents).toBe(235);
    expect(after.totalCents).toBe(1750 + 235);
    expect(after.delivery?.freeDelivery).toBe(false);
  });

  it('changing the address recalculates the fee', () => {
    expect(quote({ destination: north(1) }).baseDeliveryFeeCents).toBe(75);
    expect(quote({ destination: north(6) }).baseDeliveryFeeCents).toBe(235);
  });

  it('unsupported location: no fee, no free delivery, cannot order — even above the threshold', () => {
    const q = quote({ destination: north(18), lines: big(9000) }); // 23.4 km road > 20 km
    expect(q.delivery).toMatchObject({ status: 'unsupported', standardFeeCents: null, freeDelivery: false });
    expect(q.baseDeliveryFeeCents).toBeNull();
    expect(q.canPlace).toBe(false);
    expect(q.issues[0]).toMatch(/23\.4/);
  });

  it('no free-delivery rule configured: free delivery is never applied', () => {
    const q = quote({ settings: { ...settings, freeDeliveryMinCents: null }, destination: north(6), lines: big(99_900) });
    expect(q.delivery).toMatchObject({ freeRule: null, freeDelivery: false });
    expect(q.baseDeliveryFeeCents).toBe(235);
  });

  it('delivery switched off or next-day off: unavailable, never $0', () => {
    const off = quote({ settings: { ...settings, deliveryEnabled: false }, destination: north(6) });
    expect(off.delivery?.status).toBe('unavailable');
    expect(off.baseDeliveryFeeCents).toBeNull();
    expect(off.canPlace).toBe(false);
    const noNextDay = quote({ settings: { ...settings, nextDayEnabled: false }, destination: north(6), deliverySpeed: 'next_day' });
    expect(noNextDay.delivery?.status).toBe('unavailable');
    expect(noNextDay.baseDeliveryFeeCents).toBeNull();
  });

  it('a free-delivery reward waits for a validated location instead of showing $0', () => {
    const fd = { id: 9, title: 'Free delivery', code: null, discountType: 'free_delivery' as const, value: 0, freeProductId: null, minSubtotalCents: 0, maxDiscountCents: null, startsAt: null, endsAt: null, active: true };
    const pending = quote({ coupon: fd });
    expect(pending.deliveryDiscountCents).toBe(0);
    expect(pending.baseDeliveryFeeCents).toBeNull();
    const ok = quote({ coupon: fd, destination: north(6) });
    expect(ok.deliveryDiscountCents).toBe(235);
  });
});

describe('Google Maps links', () => {
  it('reads coordinates from the usual link formats and from pasted "lat, lng"', () => {
    expect(coordsFromText('11.5564, 104.9282')).toEqual({ lat: 11.5564, lng: 104.9282 });
    expect(coordsFromText('https://www.google.com/maps/place/mart25/@11.5701,104.9105,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d11.5703!4d104.9112')).toEqual({
      lat: 11.5703,
      lng: 104.9112,
    });
    expect(coordsFromText('https://www.google.com/maps/@11.55,104.92,15z')).toEqual({ lat: 11.55, lng: 104.92 });
    expect(coordsFromText('https://maps.google.com/?q=11.5631%2C104.9157&g_st=ic')).toEqual({ lat: 11.5631, lng: 104.9157 });
    expect(coordsFromText('https://www.google.com/maps/search/11.5631,+104.9157?entry=tts')).toEqual({ lat: 11.5631, lng: 104.9157 });
    expect(coordsFromText('no coordinates here')).toBeNull();
  });

  it('follows Google short-link redirects', async () => {
    const hops: Record<string, Response> = {
      'https://maps.app.goo.gl/abc': new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/mart25/data=!4m2!3m1!1s0x31?g_st=ic' } }),
      'https://www.google.com/maps/place/mart25/data=!4m2!3m1!1s0x31?g_st=ic': new Response(
        '<meta content="https://maps.google.com/maps/api/staticmap?center=11.5701%2C104.9105&amp;zoom=17" property="og:image">',
        { status: 200 },
      ),
    };
    const fake = (async (url: string) => hops[url] ?? new Response('', { status: 404 })) as typeof fetch;
    expect(await resolveMapsLink('https://maps.app.goo.gl/abc', fake)).toEqual({ lat: 11.5701, lng: 104.9105 });
  });

  it('never fetches anything that is not Google', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response('');
    }) as typeof fetch;
    expect(await resolveMapsLink('http://169.254.169.254/latest/meta-data', spy)).toBeNull();
    expect(await resolveMapsLink('https://evil.example/maps', spy)).toBeNull();
    expect(called).toBe(false);
  });
});
