import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { WalletItem } from '../lib/types';
import { Button, celebrate, Sheet } from './ui';

/** Milestone celebration: shown once for rewards the customer hasn't seen yet. */
export function RewardCelebration({ unseen }: { unseen: WalletItem[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const shown = useRef<string>('');
  const key = unseen.map((u) => u.id).join(',');

  useEffect(() => {
    if (!key || shown.current === key) return;
    shown.current = key;
    setOpen(true);
    setTimeout(celebrate, 200);
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
        <div className="animate-wiggle text-7xl">{first.emoji}</div>
        <div className="mt-3 text-sm font-bold uppercase tracking-wider text-amber-600">Reward unlocked!</div>
        <h2 className="mt-1 text-2xl font-extrabold">{first.title}</h2>
        <p className="mt-1 text-muted">{first.coupon.description || first.coupon.benefit}</p>
        {unseen.length > 1 && <p className="mt-2 text-sm font-semibold">+ {unseen.length - 1} more reward{unseen.length > 2 ? 's' : ''} waiting 🎁</p>}
        <div className="mt-6 grid w-full gap-2">
          <Button block size="lg" variant="sun" onClick={() => close('/shop')}>
            Use it on my next order
          </Button>
          <Button block variant="ghost" onClick={() => close('/rewards')}>
            See all my rewards
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
