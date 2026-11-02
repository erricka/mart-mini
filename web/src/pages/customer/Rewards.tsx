import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RewardCelebration } from '../../components/RewardCelebration';
import { Badge, Button, Card, CountUp, cx, ErrorState, ProgressBar, SectionTitle, Skeleton } from '../../components/ui';
import { money, shortDate } from '../../lib/format';
import { useRewards } from '../../lib/queries';
import { haptic } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { WalletItem } from '../../lib/types';

const HISTORY_LABEL: Record<string, string> = {
  signup_bonus: 'Welcome bonus',
  order_earn: 'Order completed',
  order_reversal: 'Refund adjustment',
  manual_adjustment: 'From the shop',
};

export function Rewards() {
  const q = useRewards();
  const [tab, setTab] = useState<'available' | 'used'>('available');
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-48 rounded-3xl" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const available = r.wallet.filter((w) => w.status === 'available');
  const used = r.wallet.filter((w) => w.status !== 'available');

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">Rewards</h1>

      {/* Hero */}
      <div className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 p-5 text-amber-950 shadow-lg shadow-orange-900/10">
        <div className="flex items-center justify-between">
          <Badge className="bg-white/40 text-sm">{r.level.emoji} {r.level.name}{r.level.multiplierPercent > 100 ? ` · ${r.level.multiplierPercent / 100}× points` : ''}</Badge>
          <span className="text-sm font-semibold">{r.completedOrders} orders</span>
        </div>
        <div className="mt-3 text-5xl font-black tabular-nums"><CountUp value={r.balance} /></div>
        <div className="font-semibold">points</div>
        {r.progress ? (
          <div className="mt-4 rounded-2xl bg-white/35 p-3">
            <div className="flex items-center justify-between text-sm font-bold">
              <span>{r.progress.emoji} {r.progress.title}</span>
              <span>{r.balance} / {r.progress.pointsRequired}</span>
            </div>
            <ProgressBar percent={r.progress.percent} className="mt-2 bg-white/50" tone="brand" />
            <p className="mt-2 text-sm font-semibold">
              {r.progress.remaining <= 25 ? '🔥 So close! ' : ''}You're {r.progress.remaining} points away from unlocking {r.progress.title.toLowerCase().startsWith('surprise') ? 'a surprise gift' : r.progress.title}!
            </p>
          </div>
        ) : (
          <p className="mt-3 font-semibold">Every milestone unlocked. You're a superstar! 🏆</p>
        )}
        {r.nextLevel && <p className="mt-3 text-xs font-semibold">{r.nextLevel.remaining} points to reach {r.nextLevel.emoji} {r.nextLevel.name}{r.nextLevel.multiplierPercent > 100 ? ` (${r.nextLevel.multiplierPercent / 100}× points)` : ''}</p>}
      </div>

      <p className="mt-3 text-center text-sm text-muted">Earn {r.pointsPerDollar} point per {money(100)} · points are added when your order is delivered or collected.</p>

      {/* Milestone path */}
      <SectionTitle>Milestones</SectionTitle>
      <Card className="relative">
        <ol className="space-y-4">
          {r.milestones.map((m, i) => {
            const isNext = !m.reached && (i === 0 || r.milestones[i - 1].reached);
            return (
              <li key={m.id} className="flex items-center gap-3">
                <div
                  className={cx(
                    'grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-3xl transition',
                    m.reached ? 'bg-gradient-to-br from-amber-200 to-orange-300' : isNext ? 'animate-pulse-ring bg-amber-100 dark:bg-amber-500/20' : 'bg-surface-2 grayscale',
                  )}
                >
                  {m.reached ? m.emoji : isNext ? m.emoji : '🔒'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cx('font-bold', !m.reached && !isNext && 'text-muted')}>{m.title}</span>
                    {m.reached && <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">{m.walletStatus === 'used' ? 'Used' : m.walletStatus === 'expired' ? 'Expired' : 'Unlocked'}</Badge>}
                  </div>
                  <div className="text-sm text-muted">{m.benefit}</div>
                </div>
                <div className={cx('text-right text-sm font-extrabold', m.reached ? 'text-amber-600' : 'text-muted')}>{m.pointsRequired} pts</div>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Wallet */}
      <SectionTitle>My rewards & coupons</SectionTitle>
      <div className="mb-3 flex gap-2">
        {(['available', 'used'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t ? 'bg-ink text-bg' : 'bg-surface ring-1 ring-line')}>
            {t === 'available' ? `Available (${available.length})` : `Used & expired (${used.length})`}
          </button>
        ))}
      </div>
      <div className="space-y-2.5">
        {(tab === 'available' ? available : used).map((w) => <WalletCard key={w.id} w={w} />)}
        {tab === 'available' && available.length === 0 && (
          <Card className="text-center text-sm text-muted">No rewards to use right now — keep shopping to unlock the next one! 🌱</Card>
        )}
        {tab === 'available' &&
          r.publicCoupons.map((c) => (
            <Card key={c.id} className="flex items-center gap-3 border-2 border-dashed border-line">
              <span className="text-2xl">🏷️</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{c.title}</div>
                <div className="text-xs text-muted">{c.description}</div>
              </div>
              <button
                className="rounded-xl bg-surface-2 px-3 py-2 font-mono text-sm font-bold"
                onClick={() => {
                  navigator.clipboard?.writeText(c.code ?? '').catch(() => {});
                  haptic('success');
                  toast(`Code ${c.code} copied — enter it at checkout`, 'success');
                }}
              >
                {c.code}
              </button>
            </Card>
          ))}
      </div>

      {/* Badges */}
      <SectionTitle>Badges</SectionTitle>
      <div className="grid grid-cols-3 gap-2.5">
        {r.badges.map((b) => (
          <div key={b.id} className={cx('flex flex-col items-center rounded-2xl p-3 text-center', b.earned ? 'bg-surface ring-1 ring-amber-300' : 'bg-surface-2')}>
            <span className={cx('text-3xl', !b.earned && 'opacity-40 grayscale')}>{b.emoji}</span>
            <span className={cx('mt-1 text-xs font-bold', !b.earned && 'text-muted')}>{b.title}</span>
            {!b.earned && <span className="mt-0.5 text-[10px] leading-tight text-muted">{b.hint}</span>}
          </div>
        ))}
      </div>

      {/* History */}
      <SectionTitle>Points history</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {r.history.length === 0 && <p className="p-4 text-sm text-muted">No points yet.</p>}
        {r.history.map((h) => (
          <div key={h.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-semibold">{HISTORY_LABEL[h.type] ?? h.type}{h.orderId ? ` · #${String(h.orderId).padStart(4, '0')}` : ''}</div>
              <div className="text-xs text-muted">{shortDate(h.createdAt)}{h.note && h.type === 'manual_adjustment' ? ` · ${h.note}` : ''}</div>
            </div>
            <div className={cx('font-extrabold tabular-nums', h.delta > 0 ? 'text-amber-600' : 'text-rose-600')}>{h.delta > 0 ? '+' : ''}{h.delta}</div>
          </div>
        ))}
      </Card>

      <RewardCelebration unseen={r.unseen} />
    </div>
  );
}

function WalletCard({ w }: { w: WalletItem }) {
  const usable = w.status === 'available';
  return (
    <Card className={cx('flex items-center gap-3', !usable && 'opacity-60')}>
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-200 text-2xl dark:from-amber-500/20 dark:to-orange-500/20">{w.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="font-bold">{w.title}</div>
        <div className="text-xs text-muted">
          {w.coupon.benefit}
          {w.coupon.minSubtotalCents ? ` · min ${money(w.coupon.minSubtotalCents)}` : ''}
          {usable && w.expiresAt ? ` · until ${shortDate(w.expiresAt)}` : ''}
          {w.status === 'used' && w.orderId ? ` · used on #${String(w.orderId).padStart(4, '0')}` : ''}
          {w.status === 'expired' ? ' · expired' : ''}
          {w.status === 'revoked' ? ' · removed after a refund' : ''}
        </div>
      </div>
      {usable && (
        <Link to="/shop">
          <Button size="sm" variant="sun">Use</Button>
        </Link>
      )}
    </Card>
  );
}
