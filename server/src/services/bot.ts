/**
 * Minimal Telegram bot: /start (from QR deep links too), /shop, /orders, /rewards, /dashboard.
 * Runs as a webhook in production or long-polling in local development.
 */
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { tr, userLang } from '../lib/i18n.js';
import { tgCall, webAppKeyboard } from '../lib/telegram-api.js';
import { createStaffLoginLink } from './identity.js';
import { getSettings } from './settings.js';

interface TgMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; first_name: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

async function reply(chatId: number, text: string, reply_markup?: unknown) {
  await tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup });
}

export async function handleUpdate(update: TgUpdate, log: FastifyBaseLogger) {
  const msg = update.message;
  if (!msg?.text || msg.chat.type !== 'private' || !msg.from) return;
  const [rawCmd, payload] = msg.text.trim().split(/\s+/, 2);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const settings = await getSettings();
  const shopName = settings.shopName;
  const source = payload && /^[A-Za-z0-9_-]{1,64}$/.test(payload) ? payload : null;
  // Reply in the sender's saved language (Khmer by default for people who haven't chosen yet).
  const [sender] = await db.select().from(users).where(eq(users.telegramId, msg.from.id));
  const lang = userLang(sender);
  const t = (key: Parameters<typeof tr>[0], vars: Record<string, string | number> = {}) => tr(key, { shop: shopName, ...vars }, lang);

  try {
    switch (cmd) {
      case '/start':
      case '/shop':
        await reply(msg.chat.id, t('bot.welcome'), webAppKeyboard(t('bot.open'), source ? `/?src=${source}` : '/'));
        return;
      case '/orders':
        await reply(msg.chat.id, t('bot.orders'), webAppKeyboard(t('bot.btn_orders'), '/orders'));
        return;
      case '/rewards':
        await reply(msg.chat.id, t('bot.rewards'), webAppKeyboard(t('bot.btn_rewards'), '/rewards'));
        return;
      case '/dashboard':
      case '/admin': {
        const u = sender;
        if (!u || (u.role !== 'staff' && u.role !== 'admin')) {
          await reply(msg.chat.id, t('bot.staff_only'));
          return;
        }
        const link = await createStaffLoginLink(u);
        const keyboard = config.publicUrlIsHttps
          ? {
              inline_keyboard: [
                [{ text: t('bot.btn_dash_here'), web_app: { url: new URL('/admin', config.PUBLIC_URL).toString() } }],
                [{ text: t('bot.btn_dash_browser'), url: link }],
              ],
            }
          : undefined;
        await reply(msg.chat.id, t('bot.dashboard') + (keyboard ? '' : t('bot.dashboard_link', { link })), keyboard);
        return;
      }
      default:
        await reply(msg.chat.id, t('bot.help'), webAppKeyboard(t('bot.open'), '/'));
    }
  } catch (err) {
    log.warn({ err }, 'Bot reply failed');
  }
}

export async function configureBot(log: FastifyBaseLogger) {
  if (!config.telegramConfigured) {
    log.warn('TELEGRAM_BOT_TOKEN not set — Telegram login disabled, notifications are SIMULATED.');
    return () => {};
  }
  try {
    await tgCall('setMyCommands', {
      commands: [
        { command: 'shop', description: tr('bot.cmd_shop', {}, config.DEFAULT_LANGUAGE) },
        { command: 'orders', description: tr('bot.cmd_orders', {}, config.DEFAULT_LANGUAGE) },
        { command: 'rewards', description: tr('bot.cmd_rewards', {}, config.DEFAULT_LANGUAGE) },
        { command: 'dashboard', description: tr('bot.cmd_dashboard', {}, config.DEFAULT_LANGUAGE) },
      ],
    });
    // English descriptions for Telegram clients set to English.
    await tgCall('setMyCommands', {
      language_code: 'en',
      commands: (['shop', 'orders', 'rewards', 'dashboard'] as const).map((c) => ({ command: c, description: tr(`bot.cmd_${c}`, {}, 'en') })),
    });
    if (config.TELEGRAM_SET_MENU_BUTTON && config.publicUrlIsHttps) {
      const settings = await getSettings();
      await tgCall('setChatMenuButton', {
        menu_button: { type: 'web_app', text: tr('bot.menu', {}, config.DEFAULT_LANGUAGE), web_app: { url: config.PUBLIC_URL } },
      });
      log.info(`Bot menu button → ${config.PUBLIC_URL} (${settings.shopName})`);
    }
  } catch (err) {
    log.warn({ err }, 'Could not configure bot commands/menu');
  }

  if (config.TELEGRAM_BOT_MODE === 'webhook') {
    if (!config.publicUrlIsHttps || !config.TELEGRAM_WEBHOOK_SECRET) {
      log.error('Webhook mode needs an https PUBLIC_URL and TELEGRAM_WEBHOOK_SECRET.');
      return () => {};
    }
    await tgCall('setWebhook', {
      url: new URL('/api/telegram/webhook', config.PUBLIC_URL).toString(),
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    log.info('Telegram webhook registered');
    return () => {};
  }

  if (config.TELEGRAM_BOT_MODE === 'polling') {
    const controller = new AbortController();
    void (async () => {
      await tgCall('deleteWebhook', {}).catch(() => {});
      let offset = 0;
      log.info('Telegram bot long-polling started');
      while (!controller.signal.aborted) {
        try {
          const updates = await tgCall<TgUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, controller.signal);
          for (const u of updates) {
            offset = u.update_id + 1;
            await handleUpdate(u, log);
          }
        } catch (err) {
          if (controller.signal.aborted) break;
          log.warn({ err }, 'getUpdates failed, retrying in 5s');
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    })();
    return () => controller.abort();
  }
  return () => {};
}
