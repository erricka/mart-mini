import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Notice, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';

export function BrandMark({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  return (
    <div className={`relative grid place-items-center ${size === 'lg' ? 'h-28 w-28' : 'h-16 w-16'}`}>
      <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-green-400 to-emerald-600 shadow-xl shadow-green-900/20" />
      <span className={`absolute ${size === 'lg' ? '-right-3 -top-3 text-5xl' : '-right-2 -top-2 text-3xl'} animate-float`}>☀️</span>
      <span className={`relative ${size === 'lg' ? 'text-6xl' : 'text-4xl'}`}>🧺</span>
    </div>
  );
}

export function Splash() {
  const shop = useShop();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <BrandMark />
      <div>
        <h1 className="text-2xl font-extrabold">{shop.data?.shopName ?? 'Sunny Market'}</h1>
        <p className="text-sm text-muted">Checking your Telegram account…</p>
      </div>
      <Spinner className="h-6 w-6 text-brand" />
    </div>
  );
}

/** Shown in a normal browser when DEV_LOGIN_ENABLED=true. Never available in production. */
export function DevLogin() {
  const { devLogin } = useSession();
  const navigate = useNavigate();
  const shop = useShop();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (as: 'customer' | 'admin' | 'new') => {
    setBusy(as);
    setError(null);
    try {
      await devLogin(as);
      navigate(as === 'admin' ? '/admin' : '/', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark size="md" />
        <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">DEV MODE · outside Telegram</Badge>
        <h1 className="text-2xl font-extrabold">{shop.data?.shopName ?? 'Sunny Market'}</h1>
        <p className="text-sm text-muted">
          In production customers open this app from Telegram and are verified automatically. Choose a test identity to try it in the browser.
        </p>
      </div>
      <div className="space-y-3">
        <Button block size="lg" loading={busy === 'new'} onClick={() => go('new')}>
          ✨ New customer (QR first visit)
        </Button>
        <Button block size="lg" variant="secondary" loading={busy === 'customer'} onClick={() => go('customer')}>
          👩 Alice — returning customer
        </Button>
        <Button block size="lg" variant="secondary" loading={busy === 'admin'} onClick={() => go('admin')}>
          🧑‍💼 Sam — shop admin (dashboard)
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-center text-xs text-muted">Add <code>?src=store</code> to the URL to simulate scanning the in-store QR code.</p>
    </div>
  );
}

export function OutsideTelegram() {
  const shop = useShop();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <BrandMark size="md" />
      <h1 className="text-2xl font-extrabold">Open {shop.data?.shopName ?? 'the shop'} in Telegram</h1>
      <p className="text-sm text-muted">Scan the QR code at the store or on your receipt with your phone camera — it opens our shop right inside Telegram.</p>
      <p className="text-xs text-muted">Shop staff: send /dashboard to the shop bot for a dashboard login link.</p>
    </div>
  );
}
