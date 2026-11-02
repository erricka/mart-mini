/** Thin, defensive wrapper around the official Telegram WebApp SDK (window.Telegram.WebApp). */
import { useEffect, useRef } from 'react';

interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string; photo_url?: string; allows_write_to_pm?: boolean } };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  onEvent(e: string, cb: () => void): void;
  offEvent(e: string, cb: () => void): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  requestContact?(cb: (shared: boolean, result?: { response?: string; responseUnsafe?: { contact?: { phone_number?: string } } }) => void): void;
  openTelegramLink?(url: string): void;
  requestWriteAccess?(cb?: (granted: boolean) => void): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: {
    impactOccurred(s: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(t: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | undefined = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
/** True only when actually launched inside Telegram (initData present). */
export const inTelegram = !!tg?.initData;

function applyTheme() {
  const dark = inTelegram ? tg!.colorScheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
  const bg = dark ? '#0e1411' : '#f5f7f2';
  try {
    if (inTelegram && tg!.isVersionAtLeast('6.1')) {
      tg!.setHeaderColor?.(bg);
      tg!.setBackgroundColor?.(bg);
    }
  } catch {
    /* older clients */
  }
}

export function initTelegram() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
    tg.onEvent('themeChanged', applyTheme);
  } catch {
    /* ignore */
  }
}

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' | 'warning' | 'select' = 'light') {
  const h = tg?.HapticFeedback;
  if (!h || !inTelegram) return;
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
    else if (kind === 'select') h.selectionChanged();
    else h.impactOccurred(kind);
  } catch {
    /* ignore */
  }
}

/** Shows Telegram's native back button while `onBack` is set. */
export function useTelegramBackButton(onBack: (() => void) | null) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const active = !!onBack;
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb || !inTelegram || !active) return;
    const handler = () => ref.current?.();
    bb.onClick(handler);
    bb.show();
    return () => {
      bb.offClick(handler);
      bb.hide();
    };
  }, [active]);
}

export const canRequestContact = () => inTelegram && !!tg?.requestContact && tg.isVersionAtLeast('6.9');

/**
 * Opens Telegram's native "share your phone number" sheet. Resolves with the signed response
 * (verified on the server) or null if the user declined / the client doesn't support it.
 */
export function requestTelegramContact(): Promise<{ response: string; phone: string | null } | null> {
  return new Promise((resolve) => {
    if (!canRequestContact()) return resolve(null);
    try {
      tg!.requestContact!((shared, result) => {
        if (shared && result?.response) resolve({ response: result.response, phone: result.responseUnsafe?.contact?.phone_number ?? null });
        else resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

export function confirmDialog(message: string): Promise<boolean> {
  if (inTelegram && tg?.showConfirm && tg.isVersionAtLeast('6.2')) {
    return new Promise((resolve) => tg.showConfirm!(message, (ok) => resolve(ok)));
  }
  return Promise.resolve(window.confirm(message));
}

/** QR deep links pass ?startapp=<source>; the bot's /start button passes ?src=<source>. */
export function launchSource(): string | null {
  const v = tg?.initDataUnsafe?.start_param ?? new URLSearchParams(window.location.search).get('src');
  return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/** True when the bot can't message this user yet (e.g. they opened the app from a QR link without starting the bot). */
export const needsWriteAccess = () => inTelegram && tg?.initDataUnsafe?.user?.allows_write_to_pm !== true && !!tg?.requestWriteAccess && tg.isVersionAtLeast('6.9');

/** Asks the user to let the bot send them order updates (Telegram's native permission popup). */
export function requestBotMessages(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!needsWriteAccess()) return resolve(true);
    try {
      tg!.requestWriteAccess!((granted) => resolve(granted));
    } catch {
      resolve(false);
    }
  });
}
