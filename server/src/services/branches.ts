/**
 * The shop's branches. Delivery is priced from the branch nearest the customer's pin unless they pick
 * one; pickup orders are collected at the branch they choose (nearest first).
 * A shop that hasn't set up branches keeps working from its single store in Settings.
 */
import { and, asc, eq, isNull, isNotNull, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { db, type Executor } from '../db/client.js';
import { branches, type ShopSettings } from '../db/schema.js';
import { resolveMapsLink, roadKm, type LatLng } from '../lib/geo.js';
import { pick } from '../lib/i18n.js';

export interface BranchInfo {
  /** Null only for the single-store fallback (no branches set up). */
  id: number | null;
  name: string;
  address: string;
  hours: string;
  pin: LatLng | null;
}

export interface BranchWithDistance extends BranchInfo {
  /** Estimated road km to the customer's pin (null without a pin on either side). */
  distanceKm: number | null;
}

/** Active branches in display order (names in the customer's language). */
export async function activeBranches(settings: ShopSettings, ex: Executor = db): Promise<BranchInfo[]> {
  const rows = await ex.select().from(branches).where(eq(branches.active, true)).orderBy(asc(branches.sortOrder), asc(branches.id));
  if (rows.length) {
    return rows.map((b) => ({
      id: b.id,
      name: pick(b.name, b.nameEn),
      address: b.address,
      hours: b.hours,
      pin: b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : null,
    }));
  }
  return [
    {
      id: null,
      name: settings.shopName,
      address: settings.pickupAddress,
      hours: settings.pickupHours,
      pin: settings.storeLat != null && settings.storeLng != null ? { lat: settings.storeLat, lng: settings.storeLng } : null,
    },
  ];
}

export const withDistances = (list: BranchInfo[], to: LatLng | null): BranchWithDistance[] =>
  list.map((b) => ({ ...b, distanceKm: b.pin && to ? roadKm(b.pin, to) : null }));

/**
 * The branch for this order: the one the customer picked (if it's active), otherwise the nearest to
 * their pin, otherwise the first.
 */
export function chooseBranch(list: BranchWithDistance[], branchId: number | null | undefined): BranchWithDistance {
  if (branchId != null) {
    const picked = list.find((b) => b.id === branchId);
    if (picked) return picked;
  }
  const withKm = list.filter((b) => b.distanceKm != null).sort((a, b) => a.distanceKm! - b.distanceKm!);
  return withKm[0] ?? list[0];
}

/** Pricing works from "the store": the chosen branch's pin. */
export const pricedFrom = <S extends ShopSettings>(settings: S, branch: BranchInfo): S => ({
  ...settings,
  storeLat: branch.pin?.lat ?? null,
  storeLng: branch.pin?.lng ?? null,
});

/** Branches with a Google Maps link but no pin yet → read the pin from the link (needs internet). */
export async function ensureBranchLocations(log: FastifyBaseLogger) {
  try {
    const missing = await db
      .select()
      .from(branches)
      .where(and(isNotNull(branches.mapsUrl), or(isNull(branches.lat), isNull(branches.lng))));
    for (const b of missing) {
      const pin = await resolveMapsLink(b.mapsUrl!).catch(() => null);
      if (!pin) {
        log.warn({ branch: b.name, url: b.mapsUrl }, 'Could not read the branch location from its Maps link — set the pin in Dashboard → Settings → Branches.');
        continue;
      }
      await db.update(branches).set({ lat: pin.lat, lng: pin.lng }).where(eq(branches.id, b.id));
      log.info(`📍 Branch "${b.name}" located from its Maps link: ${pin.lat}, ${pin.lng}`);
    }
  } catch (err) {
    log.warn({ err }, 'Could not resolve branch Maps links');
  }
}
