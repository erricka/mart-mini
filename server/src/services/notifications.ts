/**
 * Notification outbox. Rows are inserted inside the same transaction as the change that caused
 * them, then delivered after commit by a small worker — a Telegram outage never blocks or loses
 * an order update. When no bot token is configured (or NOTIFICATIONS_MODE=simulate) messages are
 * marked SIMULATED and logged instead of sent.
 */
import { inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db, type Executor } from '../db/client.js';
import { notifications, users } from '../db/schema.js';
import { TelegramApiError, tgCall, webAppKeyboard } from '../lib/telegram-api.js';

export interface NewNotification {
  userId?: number | null;
  chatId: number;
  kind: string;
  text: string;
  orderId?: number | null;
  buttonText?: string;
  buttonPath?: string;
}

export async function queueNotification(ex: Executor, n: NewNotification) {
  await ex.insert(notifications).values({
    userId: n.userId ?? null,
    chatId: n.chatId,
    kind: n.kind,
    text: n.text,
    orderId: n.orderId ?? null,
    buttonText: n.buttonText ?? null,
    buttonPath: n.buttonPath ?? null,
  });
}

export async function notifyStaff(ex: Executor, n: Omit<NewNotification, 'chatId' | 'userId'>) {
  const staff = await ex
    .select({ id: users.id, telegramId: users.telegramId })
    .from(users)
    .where(inArray(users.role, ['staff', 'admin']));
  for (const s of staff) await queueNotification(ex, { ...n, userId: s.id, chatId: s.telegramId });
}

let running = false;
let logger: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'> = console;

export async function dispatchPending(): Promise<number> {
  if (running) return 0;
  running = true;
  let processed = 0;
  try {
    // Claim a batch (SKIP LOCKED keeps concurrent dispatchers from grabbing the same rows).
    const { rows } = await db.execute<{
      id: number;
      chat_id: string;
      kind: string;
      text: string;
      button_text: string | null;
      button_path: string | null;
      attempts: number;
    }>(sql`
      UPDATE notifications SET attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM notifications WHERE status = 'pending' AND attempts < 5
        ORDER BY id LIMIT 25 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, chat_id, kind, text, button_text, button_path, attempts`);

    for (const n of rows) {
      processed++;
      if (config.simulateNotifications) {
        logger.info(`[SIMULATED TELEGRAM MESSAGE] → chat ${n.chat_id} (${n.kind}): ${n.text.replace(/\n/g, ' ⏎ ')}`);
        await db.execute(sql`UPDATE notifications SET status = 'simulated', sent_at = now() WHERE id = ${n.id}`);
        continue;
      }
      try {
        const reply_markup = n.button_text && n.button_path ? webAppKeyboard(n.button_text, n.button_path) : undefined;
        await tgCall('sendMessage', { chat_id: Number(n.chat_id), text: n.text, parse_mode: 'HTML', reply_markup });
        await db.execute(sql`UPDATE notifications SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = ${n.id}`);
      } catch (err) {
        const permanent = err instanceof TelegramApiError && err.permanent;
        const message = err instanceof Error ? err.message : String(err);
        const status = permanent || n.attempts >= 5 ? 'failed' : 'pending';
        await db.execute(sql`UPDATE notifications SET status = ${status}, last_error = ${message} WHERE id = ${n.id}`);
        logger.warn(`Telegram notification ${n.id} ${status}: ${message}`);
      }
    }
  } catch (err) {
    logger.error(err as Error, 'Notification dispatch failed');
  } finally {
    running = false;
  }
  return processed;
}

let autoDispatch = true;
/** Scripts and tests turn this off so no timers outlive the database pool. */
export function setAutoDispatch(on: boolean) {
  autoDispatch = on;
}

/** Deliver soon (after the current transaction has committed). */
export function kickNotifications() {
  if (autoDispatch) setTimeout(() => void dispatchPending(), 50);
}

export function startNotificationWorker(log: typeof logger) {
  logger = log;
  const timer = setInterval(() => void dispatchPending(), 15_000);
  timer.unref();
  return () => clearInterval(timer);
}

/** Escape user-provided text for Telegram HTML parse mode. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
