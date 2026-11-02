import { config } from '../config.js';

export class TelegramApiError extends Error {
  constructor(
    message: string,
    public errorCode: number,
  ) {
    super(message);
  }
  /** Errors that will never succeed on retry (user blocked the bot, chat not found, bad request). */
  get permanent() {
    return this.errorCode === 400 || this.errorCode === 403;
  }
}

export async function tgCall<T = unknown>(method: string, body: object, signal?: AbortSignal): Promise<T> {
  if (!config.TELEGRAM_BOT_TOKEN) throw new TelegramApiError('Bot token not configured', 0);
  const res = await fetch(`https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
  };
  if (!json.ok) throw new TelegramApiError(json.description ?? 'Telegram API error', json.error_code ?? res.status);
  return json.result as T;
}

/** Inline keyboard with a button that opens the Mini App at `path` (requires an HTTPS PUBLIC_URL). */
export function webAppKeyboard(text: string, path: string) {
  if (!config.publicUrlIsHttps) return undefined;
  return { inline_keyboard: [[{ text, web_app: { url: new URL(path, config.PUBLIC_URL).toString() } }]] };
}
