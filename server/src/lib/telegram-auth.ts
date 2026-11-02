import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
}

export class TelegramAuthError extends Error {}

function secretKey(botToken: string) {
  // Per Telegram docs: secret_key = HMAC_SHA256(key = "WebAppData", message = bot_token)
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function dataCheckString(params: URLSearchParams) {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/**
 * Verifies a Telegram WebApp signed query string (initData, or the `response` string returned by
 * WebApp.requestContact). Throws TelegramAuthError when the signature is wrong or the data is stale.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifySignedQuery(
  raw: string,
  botToken: string,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): URLSearchParams {
  if (!botToken) throw new TelegramAuthError('Telegram bot token is not configured');
  if (!raw || raw.length > 8192) throw new TelegramAuthError('Missing or oversized signed data');
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw new TelegramAuthError('Missing hash');

  const expected = createHmac('sha256', secretKey(botToken)).update(dataCheckString(params)).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new TelegramAuthError('Invalid signature');
  }

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) throw new TelegramAuthError('Missing auth_date');
  const nowSec = Math.floor(nowMs / 1000);
  if (authDate > nowSec + 60) throw new TelegramAuthError('auth_date is in the future');
  if (maxAgeSeconds > 0 && nowSec - authDate > maxAgeSeconds) throw new TelegramAuthError('Signed data has expired');
  return params;
}

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: number;
  startParam: string | null;
}

export function validateInitData(raw: string, botToken: string, maxAgeSeconds: number, nowMs?: number): ValidatedInitData {
  const params = verifySignedQuery(raw, botToken, maxAgeSeconds, nowMs);
  const userJson = params.get('user');
  if (!userJson) throw new TelegramAuthError('initData has no user');
  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    throw new TelegramAuthError('initData user is not valid JSON');
  }
  if (!Number.isSafeInteger(user.id) || typeof user.first_name !== 'string') {
    throw new TelegramAuthError('initData user is incomplete');
  }
  const startParam = params.get('start_param');
  return {
    user,
    authDate: Number(params.get('auth_date')),
    startParam: startParam && /^[A-Za-z0-9_-]{1,64}$/.test(startParam) ? startParam : null,
  };
}

export interface VerifiedContact {
  userId: number;
  phoneNumber: string;
  firstName?: string;
}

/** Validates the signed `response` from WebApp.requestContact and checks it belongs to `expectedUserId`. */
export function validateContactResponse(raw: string, botToken: string, expectedUserId: number, nowMs?: number): VerifiedContact {
  const params = verifySignedQuery(raw, botToken, 3600, nowMs);
  const contactJson = params.get('contact');
  if (!contactJson) throw new TelegramAuthError('No contact in response');
  let contact: { user_id?: number; phone_number?: string; first_name?: string };
  try {
    contact = JSON.parse(contactJson);
  } catch {
    throw new TelegramAuthError('Contact is not valid JSON');
  }
  if (contact.user_id !== expectedUserId) throw new TelegramAuthError('Contact belongs to a different Telegram user');
  if (!contact.phone_number) throw new TelegramAuthError('Contact has no phone number');
  return { userId: contact.user_id, phoneNumber: contact.phone_number, firstName: contact.first_name };
}

/** Builds a correctly signed query string. Used by tests and the local dev login — never trust client-built data. */
export function signQuery(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams(fields);
  const hash = createHmac('sha256', secretKey(botToken)).update(dataCheckString(params)).digest('hex');
  params.set('hash', hash);
  return params.toString();
}
