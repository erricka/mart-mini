import type { LatLng } from '../../lib/types';

export const PHNOM_PENH: LatLng = { lat: 11.5564, lng: 104.9282 };
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const sameSpot = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

/** Approximate distance in metres (good enough for "did the pin really move?"). */
export function metresBetween(a: LatLng, b: LatLng) {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110_540);
}

export interface MapViewProps {
  value: LatLng | null;
  store?: LatLng | null;
  onMove: (p: LatLng) => void;
}
