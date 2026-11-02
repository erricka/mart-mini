import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, session } from './api';
import { useCart } from './cart';
import { inTelegram, launchSource, tg } from './telegram';
import type { User } from './types';

export interface Prefill {
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  username: string | null;
}

type AuthResponse =
  | { status: 'existing'; token: string; user: User }
  | { status: 'new'; onboardingToken: string; prefill: Prefill; startParam: string | null };

export type Phase =
  | { phase: 'booting' }
  | { phase: 'onboarding'; onboardingToken: string; prefill: Prefill }
  | { phase: 'devlogin' }
  | { phase: 'outside' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; user: User };

interface Ctx {
  state: Phase;
  user: User | null;
  setUser(u: User): void;
  devLogin(as: 'customer' | 'admin' | 'new'): Promise<void>;
  finishOnboarding(token: string, user: User): void;
  signOut(): void;
  retry(): void;
}

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Phase>({ phase: 'booting' });
  const ensureOwner = useCart((s) => s.ensureOwner);
  const booting = useRef(false);

  const ready = useCallback(
    (user: User) => {
      ensureOwner(user.id);
      setState({ phase: 'ready', user });
    },
    [ensureOwner],
  );

  const handleAuth = useCallback(
    (r: AuthResponse, persist: 'tab' | 'browser') => {
      if (r.status === 'existing') {
        session.set(r.token, persist);
        ready(r.user);
      } else {
        session.set(null);
        setState({ phase: 'onboarding', onboardingToken: r.onboardingToken, prefill: r.prefill });
      }
    },
    [ready],
  );

  const boot = useCallback(async () => {
    if (booting.current) return;
    booting.current = true;
    setState({ phase: 'booting' });
    try {
      const url = new URL(window.location.href);
      // 1) Staff opened a one-time browser login link from the bot.
      const linkToken = url.pathname === '/admin/login' ? url.searchParams.get('token') : null;
      if (linkToken) {
        const r = await api<AuthResponse>('/auth/staff-link', { body: { token: linkToken }, token: null });
        window.history.replaceState(null, '', '/admin');
        return handleAuth(r, 'browser');
      }
      // 2) Inside Telegram: always re-verify the signed initData on launch.
      if (inTelegram) {
        const r = await api<AuthResponse>('/auth/telegram', { body: { initData: tg!.initData }, token: null });
        return handleAuth(r, 'tab');
      }
      // 3) Browser with a saved session (dev login or staff link).
      if (session.restore()) {
        try {
          const me = await api<{ user: User }>('/me');
          return ready(me.user);
        } catch {
          session.set(null);
        }
      }
      const shop = await api<{ devLoginEnabled: boolean }>('/shop', { token: null });
      setState(shop.devLoginEnabled ? { phase: 'devlogin' } : { phase: 'outside' });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Could not start the app.' });
    } finally {
      booting.current = false;
    }
  }, [handleAuth, ready]);

  useEffect(() => {
    session.onUnauthorized(() => void boot());
    void boot();
  }, [boot]);

  const value: Ctx = {
    state,
    user: state.phase === 'ready' ? state.user : null,
    setUser: (u) => setState({ phase: 'ready', user: u }),
    async devLogin(as) {
      const r = await api<AuthResponse>('/auth/dev', { body: { as, source: launchSource() }, token: null });
      handleAuth(r, 'browser');
    },
    finishOnboarding(token, user) {
      session.set(token, inTelegram ? 'tab' : 'browser');
      ready(user);
    },
    signOut() {
      session.set(null);
      setState({ phase: 'devlogin' });
    },
    retry: () => void boot(),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside provider');
  return ctx;
}

export const isStaff = (u: User | null) => !!u && (u.role === 'staff' || u.role === 'admin');
