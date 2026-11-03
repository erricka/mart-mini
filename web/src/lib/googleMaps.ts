/**
 * Google Maps JavaScript API loader + reverse geocoding (pin → street address).
 * The key comes from the server (/api/shop → mapsApiKey) so it can be changed without a rebuild.
 * Any failure (bad key, blocked script, no network) is reported so the map can fall back to OpenStreetMap.
 */
import type { LatLng } from './types';

export interface GeoAddress {
  /** Street / house number, sangkat, khan — goes into the "street" field. */
  line1: string;
  /** Province or city, e.g. "Phnom Penh" / "រាជធានីភ្នំពេញ". */
  city: string;
  formatted: string;
}

let loading: Promise<void> | null = null;
let failed = false;
const failListeners = new Set<() => void>();

const fail = () => {
  failed = true;
  failListeners.forEach((cb) => cb());
};

/** Called when Google rejects the key or its scripts can't load. Returns an unsubscribe function. */
export function onGoogleMapsFailure(cb: () => void) {
  failListeners.add(cb);
  return () => failListeners.delete(cb);
}

export function loadGoogleMaps(key: string, language: string): Promise<void> {
  if (failed) return Promise.reject(new Error('Google Maps unavailable'));
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    // Google calls this when the key is invalid / not allowed for this site.
    w.gm_authFailure = () => {
      fail();
      reject(new Error('Google Maps key rejected'));
    };
    w.__mart25MapsReady = () => resolve();
    // A blocked Google script would leave a broken map — fall back instead.
    document.addEventListener('securitypolicyviolation', (e) => {
      if (/google|gstatic/.test(e.blockedURI) && e.effectiveDirective.startsWith('script-src')) {
        fail();
        reject(new Error('Google Maps blocked by CSP'));
      }
    });
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&loading=async&language=${language}&region=KH&callback=__mart25MapsReady`;
    s.async = true;
    s.onerror = () => {
      fail();
      reject(new Error('Google Maps failed to load'));
    };
    document.head.appendChild(s);
    setTimeout(() => {
      if (!(window as unknown as { google?: unknown }).google) {
        fail();
        reject(new Error('Google Maps load timeout'));
      }
    }, 20_000);
  });
  return loading;
}

let geocoder: google.maps.Geocoder | null = null;

/** Pin → address in the language the map was loaded with. Null when Google has nothing useful. */
export async function reverseGeocode(p: LatLng): Promise<GeoAddress | null> {
  try {
    if (!geocoder) {
      const { Geocoder } = (await google.maps.importLibrary('geocoding')) as google.maps.GeocodingLibrary;
      geocoder = new Geocoder();
    }
    const { results } = await geocoder.geocode({ location: p });
    return toAddress(results);
  } catch {
    return null;
  }
}

/** Builds "street, sangkat, khan" + city from Google's address parts (Cambodian addresses often lack a street). */
export function toAddress(results: google.maps.GeocoderResult[]): GeoAddress | null {
  const r = results.find((x) => !x.types.includes('plus_code')) ?? results[0];
  if (!r) return null;
  const get = (type: string) => r.address_components.find((c) => c.types.includes(type))?.long_name;
  const street = [get('street_number'), get('route')].filter(Boolean).join(' ') || get('premise') || get('point_of_interest') || '';
  const parts = [street, get('sublocality_level_1') ?? get('sublocality') ?? get('neighborhood'), get('administrative_area_level_2')]
    .filter((x): x is string => !!x)
    .filter((x, i, all) => all.indexOf(x) === i);
  const city = get('administrative_area_level_1') ?? get('locality') ?? '';
  let line1 = parts.filter((x) => x !== city).join(', ');
  if (!line1) {
    // Fall back to the formatted address without the city / country tail.
    const bits = r.formatted_address.split(',').map((x) => x.trim());
    line1 = bits.slice(0, Math.max(1, bits.length - 2)).join(', ');
  }
  return { line1, city, formatted: r.formatted_address };
}
