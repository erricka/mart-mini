import { ShoppingBasket } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Badge, Button, Notice, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';

export function BrandMark({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  return (
    <div className={`grid place-items-center rounded-[28%] bg-brand text-brand-ink ${size === 'lg' ? 'h-20 w-20' : 'h-14 w-14'}`}>
      <ShoppingBasket className={size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'} strokeWidth={1.75} />
    </div>
  );
}

export function Splash() {
  const shop = useShop();
  const { t } = useT();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-8 text-center">
      <BrandMark />
      <div>
        <h1 className="text-xl font-bold">{shop.data?.shopName ?? 'mart25'}</h1>
        <p className="text-sm text-muted">{t('entry.checking')}</p>
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
  const { t } = useT();
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
      <div className="flex justify-end">
        <LanguageSwitch />
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark size="md" />
        <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">{t('entry.dev_badge')}</Badge>
        <h1 className="text-xl font-bold">{shop.data?.shopName ?? 'mart25'}</h1>
        <p className="text-sm text-muted">{t('entry.dev_text')}</p>
      </div>
      <div className="space-y-3">
        <Button block size="lg" loading={busy === 'new'} onClick={() => go('new')}>
          {t('entry.dev_new')}
        </Button>
        <Button block size="lg" variant="secondary" loading={busy === 'customer'} onClick={() => go('customer')}>
          {t('entry.dev_customer')}
        </Button>
        <Button block size="lg" variant="secondary" loading={busy === 'admin'} onClick={() => go('admin')}>
          {t('entry.dev_admin')}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-center text-xs text-muted">{t('entry.dev_hint')}</p>
    </div>
  );
}

export function OutsideTelegram() {
  const shop = useShop();
  const { t } = useT();
  const name = shop.data?.shopName ?? 'mart25';
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <LanguageSwitch />
      <BrandMark size="md" />
      <h1 className="text-xl font-bold">{t('entry.outside_title', { shop: name })}</h1>
      <p className="text-sm text-muted">{t('entry.outside_text')}</p>
      <p className="text-xs text-muted">{t('entry.outside_staff')}</p>
    </div>
  );
}
