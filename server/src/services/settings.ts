import { asc, eq } from 'drizzle-orm';
import { db, type Executor } from '../db/client.js';
import { levels, shopSettings, type Level, type ShopSettings } from '../db/schema.js';
import { pick, tr } from '../lib/i18n.js';

export async function getSettings(ex: Executor = db): Promise<ShopSettings> {
  const [row] = await ex.select().from(shopSettings).where(eq(shopSettings.id, 1));
  if (row) return row;
  await ex.insert(shopSettings).values({ id: 1 }).onConflictDoNothing();
  const [created] = await ex.select().from(shopSettings).where(eq(shopSettings.id, 1));
  return created;
}

export async function getLevels(ex: Executor = db): Promise<Level[]> {
  return ex.select().from(levels).orderBy(asc(levels.minPoints));
}

const DEFAULT_LEVEL: Level = {
  id: 0,
  name: 'Member',
  emoji: '⭐',
  minPoints: 0,
  multiplierPercent: 100,
  color: '#22c55e',
  nameEn: null,
  createdAt: new Date(0),
};

/** Level with its display name in the current language. */
export const localLevel = (l: Level): Level => ({ ...l, name: pick(l.name, l.nameEn) });

export function levelFor(all: Level[], points: number): { current: Level; next: Level | null } {
  const sorted = [...all].sort((a, b) => a.minPoints - b.minPoints);
  let current = { ...DEFAULT_LEVEL, name: tr('rw.member') };
  let next: Level | null = null;
  for (const l of sorted) {
    if (l.minPoints <= points) current = localLevel(l);
    else {
      next = localLevel(l);
      break;
    }
  }
  return { current, next };
}
