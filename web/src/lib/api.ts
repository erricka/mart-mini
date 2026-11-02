import { getLang, translate } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

const STORAGE_KEY = 'sm-session';
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const session = {
  get: () => token,
  /** Inside Telegram we re-verify initData on every launch, so the token only lives in memory/sessionStorage. */
  set(t: string | null, persist: 'memory' | 'tab' | 'browser' = 'tab') {
    token = t;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY);
      if (t && persist === 'tab') sessionStorage.setItem(STORAGE_KEY, t);
      if (t && persist === 'browser') localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable */
    }
  },
  restore(): string | null {
    try {
      token = sessionStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(STORAGE_KEY);
    } catch {
      token = null;
    }
    return token;
  },
  onUnauthorized(cb: () => void) {
    onUnauthorized = cb;
  },
};

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  token?: string | null;
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-lang': getLang() };
  const t = opts.token !== undefined ? opts.token : token;
  if (t) headers.authorization = `Bearer ${t}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  } catch {
    throw new ApiError(0, 'network', translate('common.network'));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && opts.token === undefined && token) onUnauthorized?.();
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? translate('common.error_generic'), e?.details);
  }
  return data as T;
}

/** Fetch a binary resource (e.g. QR image) with the session header. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`/api${path}`, { headers: token ? { authorization: `Bearer ${token}`, 'x-lang': getLang() } : { 'x-lang': getLang() } });
  if (!res.ok) throw new ApiError(res.status, 'error', translate('common.error_generic'));
  return res.blob();
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : translate('common.error_generic'));
