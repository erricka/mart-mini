import { Lock, Star, Ticket } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RewardCelebration } from '../../components/RewardCelebration';
import { Badge, Button, Card, CountUp, cx, ErrorState, ProgressBar, SectionTitle, Skeleton } from '../../components/ui';
import { money, orderCode, shortDate } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';
import { useRewards } from '../../lib/queries';
import { haptic } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { WalletItem } from '../../lib/types';

export function Rewards() {
  const q = useRewards();
  const { t } = useT();
  const [tab, setTab] = useState<'available' | 'used'>('available');
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-44" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const available = r.wallet.filter((w) => w.status === 'available');
  const used = r.wallet.filter((w) => w.status !== 'available');

  return (
    <div>
      <h1 className="text-[22px] font-bold">{t('rw.title')}</h1>

      {/* Points */}
      <div className="mt-4 rounded-2xl bg-surface ring-1 ring-line p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold">
            {r.level.name}
            {r.level.multiplierPercent > 100 ? <span className="text-muted"> · {t('rw.x_points', { n: r.level.multiplierPercent / 100 })}</span> : null}
          </span>
          <span className="text-muted">{t('rw.orders', { n: r.completedOrders })}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Star className="h-7 w-7 fill-amber-400 text-amber-400" />
          <span className="text-4xl font-bold tabular-nums"><CountUp value={r.balance} /></span>
          <span className="self-end pb-1 text-sm text-muted">{t('common.points')}</span>
        </div>
        {r.progress ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{r.progress.title}</span>
              <span className="tabular-nums text-muted">{r.balance} / {r.progress.pointsRequired}</span>
            </div>
            <ProgressBar percent={r.progress.percent} className="mt-2" tone="sun" />
            <p className="mt-2 text-sm text-muted">
              {r.progress.remaining <= 25 ? t('rw.so_close') : ''}
              {t('rw.away', { n: r.progress.remaining, reward: r.progress.title })}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">{t('rw.all_done')}</p>
        )}
        {r.nextLevel && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
            {t('rw.next_level', { n: r.nextLevel.remaining, level: r.nextLevel.name })}
            {r.nextLevel.multiplierPercent > 100 ? t('rw.next_level_x', { n: r.nextLevel.multiplierPercent / 100 }) : ''}
          </p>
        )}
      </div>

      <p className="mt-3 text-center text-sm text-muted">{t('rw.earn_rule', { n: r.pointsPerDollar, amount: money(100) })}</p>

      {/* Milestone path */}
      <SectionTitle>{t('rw.milestones')}</SectionTitle>
      <Card className="relative">
        <ol className="space-y-4">
          {r.milestones.map((m, i) => {
            const isNext = !m.reached && (i === 0 || r.milestones[i - 1].reached);
            return (
              <li key={m.id} className="flex items-center gap-3">
                <div
                  className={cx(
                    'grid h-12 w-12 shrink-0 place-items-center rounded-full text-2xl',
                    m.reached ? 'bg-amber-50 dark:bg-amber-500/15' : isNext ? 'bg-amber-50 ring-2 ring-amber-300 dark:bg-amber-500/15' : 'bg-surface-2 text-muted',
                  )}
                >
                  {m.reached || isNext ? m.emoji : <Lock className="h-5 w-5" strokeWidth={1.9} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx('font-semibold', !m.reached && !isNext && 'text-muted')}>{m.title}</span>
                    {m.reached && <Badge className="bg-brand/10 text-brand">{m.walletStatus === 'used' ? t('rw.used') : m.walletStatus === 'expired' ? t('rw.expired') : t('rw.unlocked')}</Badge>}
                  </div>
                  <div className="text-sm text-muted">{m.benefit}</div>
                </div>
                <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-muted">{m.pointsRequired} {t('common.pts')}</div>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Wallet */}
      <SectionTitle>{t('rw.wallet')}</SectionTitle>
      <div className="mb-3 flex gap-2">
        {(['available', 'used'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-medium', tab === k ? 'bg-brand text-brand-ink' : 'bg-surface ring-1 ring-line')}>
            {k === 'available' ? t('rw.available', { n: available.length }) : t('rw.used_expired', { n: used.length })}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {(tab === 'available' ? available : used).map((w) => <WalletCard key={w.id} w={w} />)}
        {tab === 'available' && available.length === 0 && (
          <Card className="text-center text-sm text-muted">{t('rw.none')}</Card>
        )}
        {tab === 'available' &&
          r.publicCoupons.map((c) => (
            <Card key={c.id} className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
                <Ticket className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.title}</div>
                <div className="text-xs text-muted">{c.description}</div>
              </div>
              <button
                className="rounded-lg bg-surface-2 px-3 py-1.5 font-mono text-sm font-bold"
                onClick={() => {
                  navigator.clipboard?.writeText(c.code ?? '').catch(() => {});
                  haptic('success');
                  toast(t('rw.code_copied', { code: c.code ?? '' }), 'success');
                }}
              >
                {c.code}
              </button>
            </Card>
          ))}
      </div>

      {/* Badges */}
      <SectionTitle>{t('rw.badges')}</SectionTitle>
      <div className="grid grid-cols-3 gap-2.5">
        {r.badges.map((b) => (
          <div key={b.id} className={cx('flex flex-col items-center rounded-2xl bg-surface ring-1 ring-line p-3 text-center', !b.earned && 'opacity-70')}>
            <span className={cx('text-3xl', !b.earned && 'opacity-40 grayscale')}>{b.emoji}</span>
            <span className={cx('mt-1 text-xs font-semibold', !b.earned && 'text-muted')}>{b.title}</span>
            {!b.earned && <span className="mt-0.5 text-[10px] leading-tight text-muted">{b.hint}</span>}
          </div>
        ))}
      </div>

      {/* History */}
      <SectionTitle>{t('rw.history')}</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {r.history.length === 0 && <p className="p-4 text-sm text-muted">{t('rw.no_points')}</p>}
        {r.history.map((h) => (
          <div key={h.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-semibold">{t(`rw.h_${h.type}` as TKey)}{h.orderId ? ` · ${orderCode(h.orderId)}` : ''}</div>
              <div className="text-xs text-muted">{shortDate(h.createdAt)}{h.note && h.type === 'manual_adjustment' ? ` · ${h.note}` : ''}</div>
            </div>
            <div className={cx('font-semibold tabular-nums', h.delta > 0 ? 'text-brand' : 'text-rose-600')}>{h.delta > 0 ? '+' : ''}{h.delta}</div>
          </div>
        ))}
      </Card>

      <RewardCelebration unseen={r.unseen} />
    </div>
  );
}

function WalletCard({ w }: { w: WalletItem }) {
  const { t } = useT();
  const usable = w.status === 'available';
  return (
    <Card className={cx('flex items-center gap-3', !usable && 'opacity-60')}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-amber-50 text-2xl dark:bg-amber-500/15">{w.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{w.title}</div>
        <div className="text-xs text-muted">
          {w.coupon.benefit}
          {w.coupon.minSubtotalCents ? t('rw.min', { amount: money(w.coupon.minSubtotalCents) }) : ''}
          {usable && w.expiresAt ? t('rw.until', { date: shortDate(w.expiresAt) }) : ''}
          {w.status === 'used' && w.orderId ? t('rw.used_on', { code: orderCode(w.orderId) }) : ''}
          {w.status === 'expired' ? t('rw.expired_suffix') : ''}
          {w.status === 'revoked' ? t('rw.revoked_suffix') : ''}
        </div>
      </div>
      {usable && (
        <Link to="/shop">
          <Button size="sm">{t('rw.use')}</Button>
        </Link>
      )}
    </Card>
  );
}
