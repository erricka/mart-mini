import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from the server folder or the repo root (whichever exists). Real env vars win.
dotenv.config({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')], quiet: true });

// Hosting platforms expose the public URL themselves, so PUBLIC_URL can usually be left empty there.
const platformUrl =
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: bool(false),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v || platformUrl || 'http://localhost:5173').replace(/\/+$/, '')),
  MIGRATE_ON_START: bool(false),
  /** "starter" = on first boot of an empty database, create settings, levels, rewards and aisles (no demo data). */
  SEED_ON_START: z.enum(['', 'starter']).optional().default(''),

  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_BOT_USERNAME: z.string().optional().default(''),
  TELEGRAM_MINIAPP_SHORT_NAME: z.string().optional().default(''),
  TELEGRAM_BOT_MODE: z.enum(['off', 'polling', 'webhook']).default('off'),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().default(''),
  TELEGRAM_SET_MENU_BUTTON: bool(true),
  INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().default(86400),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isSafeInteger(n)),
    ),

  /** Language used before a customer picks one, and for messages to people without a saved choice. */
  DEFAULT_LANGUAGE: z.enum(['km', 'en']).default('km'),
  /** auto = send through Telegram when a bot token exists, otherwise simulate. simulate = never send. */
  NOTIFICATIONS_MODE: z.enum(['auto', 'simulate']).default('auto'),
  /** Enables the "Dev login" buttons outside Telegram. Always disabled in production. */
  DEV_LOGIN_ENABLED: bool(false),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(3),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`   ${issue.path.join('.')}: ${issue.message}`);
  console.error('   Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const env = parsed.data;

/**
 * Telegram only accepts A-Z a-z 0-9 _ - (1–256 chars) as a webhook secret_token. Generated secrets
 * (e.g. Render's generateValue) can contain + / =, so anything else is turned into its SHA-256 hex,
 * which is valid and still secret. The same value is used for setWebhook and for checking the header.
 */
export function telegramSafeSecret(secret: string): string {
  if (!secret) return '';
  return /^[A-Za-z0-9_-]{1,256}$/.test(secret) ? secret : createHash('sha256').update(secret).digest('hex');
}

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  devLoginEnabled: env.DEV_LOGIN_ENABLED && env.NODE_ENV !== 'production',
  telegramConfigured: env.TELEGRAM_BOT_TOKEN.length > 0,
  simulateNotifications: env.NOTIFICATIONS_MODE === 'simulate' || env.TELEGRAM_BOT_TOKEN.length === 0,
  publicUrlIsHttps: env.PUBLIC_URL.startsWith('https://'),
  webhookSecret: telegramSafeSecret(env.TELEGRAM_WEBHOOK_SECRET),
  uploadDir: resolve(process.cwd(), env.UPLOAD_DIR),
};

export type AppConfig = typeof config;
