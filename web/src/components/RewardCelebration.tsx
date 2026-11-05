import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import type { WalletItem } from '../lib/types';
import { haptic } from '../lib/telegram';
import { Button, Sheet } from './ui';

/** A new reward: shown once (calmly) for rewards the customer hasn't seen yet. */
export function RewardCelebration({ unseen }: { unseen: WalletItem[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const shown = useRef<string>('');
  const key = unseen.map((u) => u.id).join(',');

  useEffect(() => {
    if (!key || shown.current === key) return;
    shown.current = key;
    setOpen(true);
    haptic('success');
  }, [key]);

  const close = async (go?: string) => {
    setOpen(false);
    await api('/rewards/seen', { body: { ids: unseen.map((u) => u.id) } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['home'] });
    qc.invalidateQueries({ queryKey: ['rewards'] });
    if (go) navigate(go);
  };

  if (!unseen.length) return null;
  const first = unseen[0];
  return (
    <Sheet open={open} onClose={() => close()}>
      <div className="flex flex-col items-center py-2 text-center">
        <div className="grid h-20 w-20 place-items-center rounded-full bg-amber-50 text-5xl dark:bg-amber-500/10">{first.emoji}</div>
        <div className="mt-4 text-sm font-semibold text-amber-600">{t('cel.unlocked')}</div>
        <h2 className="mt-1 text-xl font-bold">{first.title}</h2>
        <p className="mt-1 text-muted">{first.coupon.description || first.coupon.benefit}</p>
        {unseen.length > 1 && <p className="mt-2 text-sm font-semibold">{t('cel.more', { n: unseen.length - 1 })}</p>}
        <div className="mt-6 grid w-full gap-2">
          <Button block size="lg" onClick={() => close('/shop')}>
            {t('cel.use_next')}
          </Button>
          <Button block variant="ghost" onClick={() => close('/rewards')}>
            {t('cel.see_all')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
