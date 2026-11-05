/**
 * Images stored in the database (table `media`), served at /media/<id>.
 * Also moves photos uploaded to the old on-disk folder (/uploads/…) into the database on start-up,
 * so switching to a host without a persistent disk loses nothing.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { eq, like, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { media, orderItems, products } from '../db/schema.js';

export const MEDIA_ID = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
/** A product photo link we accept: our own uploaded photo, an old /uploads/ file, or an https:// image. */
export const isPhotoUrl = (v: string) =>
  /^\/media\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(v) || /^\/uploads\/[\w.-]+$/.test(v) || /^https:\/\/\S+$/.test(v);
const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export async function saveMedia(bytes: Buffer, ext: string): Promise<string> {
  const id = `${randomUUID()}.${ext}`;
  await db.insert(media).values({ id, contentType: TYPES[ext] ?? 'application/octet-stream', bytes, size: bytes.length });
  return `/media/${id}`;
}

export async function getMedia(id: string) {
  if (!MEDIA_ID.test(id)) return null;
  const [row] = await db.select().from(media).where(eq(media.id, id));
  return row ?? null;
}

/** Copies every product photo still pointing at /uploads/<file> into the database and rewrites the links. */
export async function importDiskPhotos(log: FastifyBaseLogger) {
  try {
    const rows = await db.select({ id: products.id, imageUrl: products.imageUrl }).from(products).where(like(products.imageUrl, '/uploads/%'));
    if (!rows.length) return;
    let moved = 0;
    let missing = 0;
    for (const r of rows) {
      const file = basename(r.imageUrl!);
      const ext = file.split('.').pop()?.toLowerCase() ?? '';
      if (!TYPES[ext]) continue;
      let bytes: Buffer;
      try {
        bytes = await readFile(join(config.uploadDir, file));
      } catch {
        missing++;
        continue;
      }
      const url = await saveMedia(bytes, ext);
      await db.update(products).set({ imageUrl: url }).where(eq(products.id, r.id));
      // Past orders keep showing the same picture.
      await db.update(orderItems).set({ imageUrl: url }).where(eq(orderItems.imageUrl, r.imageUrl!));
      moved++;
    }
    log.info(`🖼️ Moved ${moved} product photo(s) from disk into the database${missing ? ` (${missing} file(s) not found on this server)` : ''}.`);
  } catch (err) {
    log.error({ err }, 'Could not move product photos into the database');
  }
}

export const mediaCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(media))[0].n;
