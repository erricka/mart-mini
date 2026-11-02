import { describe, expect, it } from 'vitest';
import { signQuery, validateContactResponse, validateInitData, TelegramAuthError } from '../src/lib/telegram-auth.js';

const TOKEN = '123456:TEST_BOT_TOKEN_for_signature_checks';
const now = Math.floor(Date.now() / 1000);
const user = { id: 42, first_name: 'Ana', username: 'ana', photo_url: 'https://t.me/i/userpic/320/ana.jpg' };
const fields = (over: Record<string, string> = {}) => ({
  query_id: 'AAH',
  user: JSON.stringify(user),
  auth_date: String(now),
  start_param: 'store',
  signature: 'ed25519-signature-is-also-covered-by-the-hash',
  ...over,
});

describe('Telegram initData validation', () => {
  it('accepts correctly signed data and extracts user + start_param', () => {
    const r = validateInitData(signQuery(fields(), TOKEN), TOKEN, 3600);
    expect(r.user.id).toBe(42);
    expect(r.startParam).toBe('store');
  });

  it('rejects data signed with another bot token', () => {
    expect(() => validateInitData(signQuery(fields(), '999:OTHER'), TOKEN, 3600)).toThrow(TelegramAuthError);
  });

  it('rejects tampered data (e.g. changed user id)', () => {
    const tampered = signQuery(fields(), TOKEN).replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(() => validateInitData(tampered, TOKEN, 3600)).toThrow('Invalid signature');
  });

  it('rejects stale data', () => {
    const old = signQuery(fields({ auth_date: String(now - 7200) }), TOKEN);
    expect(() => validateInitData(old, TOKEN, 3600)).toThrow('expired');
  });

  it('rejects data with no hash', () => {
    expect(() => validateInitData(new URLSearchParams(fields()).toString(), TOKEN, 3600)).toThrow('Missing hash');
  });

  it('ignores malformed start_param values', () => {
    const r = validateInitData(signQuery(fields({ start_param: '<script>' }), TOKEN), TOKEN, 3600);
    expect(r.startParam).toBeNull();
  });
});

describe('requestContact response validation', () => {
  const contact = (userId: number) =>
    signQuery({ contact: JSON.stringify({ user_id: userId, phone_number: '15551234567', first_name: 'Ana' }), auth_date: String(now) }, TOKEN);

  it("accepts the user's own contact", () => {
    expect(validateContactResponse(contact(42), TOKEN, 42).phoneNumber).toBe('15551234567');
  });

  it("rejects someone else's contact", () => {
    expect(() => validateContactResponse(contact(7), TOKEN, 42)).toThrow('different Telegram user');
  });
});
