/**
 * Keeps Google Maps free: every Google map shown and every pin → address look-up is counted before
 * it happens. Past the daily or monthly limit the browser is told "no", and uses the free
 * OpenStreetMap map / lets the customer type the address instead. Google bills per calendar month
 * in Pacific time, so days are counted in that time zone.
 */
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';

export type MapsKind = 'map' | 'geocode';

const pacificDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now); // YYYY-MM-DD

/** Atomically counts one use if both limits allow it. Returns false when the budget is used up. */
export async function allowMapsUse(
  kind: MapsKind,
  limits: { daily: number; monthly: number } = { daily: config.MAPS_DAILY_LIMIT, monthly: config.MAPS_MONTHLY_LIMIT },
  now = new Date(),
): Promise<boolean> {
  if (!config.GOOGLE_MAPS_API_KEY && !config.isTest) return false;
  const day = pacificDay(now);
  const monthStart = `${day.slice(0, 7)}-01`;
  const { rows } = await db.execute<{ count: number }>(sql`
    insert into maps_usage (day, kind, count)
    select ${day}::date, ${kind}, 1
    where (select coalesce(sum(count), 0) from maps_usage where kind = ${kind} and day >= ${monthStart}::date) < ${limits.monthly}
      and ${limits.daily} > 0
    on conflict (day, kind) do update set count = maps_usage.count + 1
      where maps_usage.count < ${limits.daily}
    returning count`);
  return rows.length > 0;
}

/** This month's counts (Settings shows them). */
export async function mapsUsageThisMonth(now = new Date()) {
  const day = pacificDay(now);
  const { rows } = await db.execute<{ kind: string; n: number }>(
    sql`select kind, coalesce(sum(count), 0)::int as n from maps_usage where day >= ${`${day.slice(0, 7)}-01`}::date group by kind`,
  );
  const get = (k: string) => rows.find((r) => r.kind === k)?.n ?? 0;
  return { maps: get('map'), geocodes: get('geocode'), monthlyLimit: config.MAPS_MONTHLY_LIMIT, dailyLimit: config.MAPS_DAILY_LIMIT };
}
