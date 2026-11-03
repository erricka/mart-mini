/**
 * Maps helpers: straight-line distance → estimated road distance, Cambodia dates, and turning a
 * Google Maps link (or pasted coordinates) into a store pin.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Roads are rarely straight: a typical city detour factor turns straight-line km into road km. */
export const ROAD_FACTOR = 1.3;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance, rounded to 0.1 km (what the fee is based on). */
export const roadKm = (a: LatLng, b: LatLng) => Math.round(haversineKm(a, b) * ROAD_FACTOR * 10) / 10;

/** Calendar date in Cambodia (UTC+7, no daylight saving), optionally a few days ahead: "2026-11-04". */
export function cambodiaDate(now: Date, addDays = 0): string {
  return new Date(now.getTime() + 7 * 3_600_000 + addDays * 86_400_000).toISOString().slice(0, 10);
}

export const googleMapsPin = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const googleMapsDirections = (from: LatLng | null, to: LatLng) =>
  `https://www.google.com/maps/dir/?api=1${from ? `&origin=${from.lat},${from.lng}` : ''}&destination=${to.lat},${to.lng}&travelmode=driving`;

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }
    : null;

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PATTERNS: RegExp[] = [
  // Exact place pin inside Google's data parameter.
  new RegExp(`!3d${NUM}!4d${NUM}`),
  // ?q=11.55,104.92 / ll= / query= / destination= / center=
  new RegExp(`[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?${NUM}\\s*,\\s*\\+?${NUM}`),
  // /maps/search/11.55,+104.92 or /maps/place/11.55,104.92
  new RegExp(`/(?:search|place|dir)/${NUM}\\s*,\\s*\\+?${NUM}`),
  // Map viewport centre: /@11.55,104.92,17z
  new RegExp(`@${NUM},${NUM}`),
];

/** Finds coordinates in a Google Maps URL, page snippet, or plain "11.5564, 104.9282" text. */
export function coordsFromText(text: string): LatLng | null {
  let s = text;
  try {
    s = decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    /* keep raw */
  }
  const plain = s.match(/^\s*(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*$/);
  if (plain) return valid(Number(plain[1]), Number(plain[2]));
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) {
      const p = valid(Number(m[1]), Number(m[2]));
      if (p) return p;
    }
  }
  return null;
}

const ALLOWED_HOST = /(^|\.)(google\.[a-z.]{2,8}|goo\.gl)$/i;

/**
 * Turns a Google Maps share link (maps.app.goo.gl/…, goo.gl/maps/…, google.com/maps/…) or pasted
 * coordinates into a pin. Follows Google's redirects only (no other hosts), then reads the page.
 */
export async function resolveMapsLink(input: string, fetchImpl: typeof fetch = fetch): Promise<LatLng | null> {
  const direct = coordsFromText(input.trim());
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!ALLOWED_HOST.test(url.hostname)) return null;
    const found = coordsFromText(url.href);
    if (found) return found;
    // Cookie-consent interstitials carry the real destination in ?continue=
    const cont = url.searchParams.get('continue');
    if (cont) {
      url = new URL(cont);
      continue;
    }
    const res = await fetchImpl(url.href, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; mart25-shop/1.0)', 'accept-language': 'en' },
      signal: AbortSignal.timeout(8000),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, 2_000_000);
    return coordsFromText(body) ?? pageCoords(body);
  }
  return null;
}

/** Last resort inside a Maps page: preview image centre or the first [null,null,lat,lng] tuple. */
function pageCoords(html: string): LatLng | null {
  const center = html.match(/center=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/);
  if (center) return valid(Number(center[1]), Number(center[2]));
  const tuple = html.match(/\[null,null,(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)\]/);
  if (tuple) return valid(Number(tuple[1]), Number(tuple[2]));
  return null;
}
