import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, cx, ErrorState, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { money } from '../../lib/format';
import { STATUS_META } from '../../lib/status';
import type { OrderStatus } from '../../lib/types';
import { PageHeader } from './common';

interface Stats {
  days: number;
  currency: string;
  kpi: { revenue_cents: number; completed: number; placed: number; cancelled: number; avg_basket_cents: number; new_customers: number; points_issued: number; rewards_used: number };
  daily: { day: string; orders: number; revenue_cents: number }[];
  topProducts: { product_id: number; name: string; emoji: string; quantity: number; revenue_cents: number }[];
  openByStatus: { status: OrderStatus; n: number }[];
  fulfillmentMix: { fulfillment_type: 'delivery' | 'pickup'; n: number }[];
  signups: { source: string; n: number }[];
  lowStock: { id: number; name: string; emoji: string; stock: number }[];
}

const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const moneyCompact = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: cents >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: cents >= 100_000 ? 0 : 2 }).format(cents / 100);
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function InsightsPage() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ['admin', 'stats', days], queryFn: () => api<Stats>(`/admin/stats?days=${days}`), placeholderData: (p) => p });

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Revenue counts completed, non-refunded orders."
        actions={
          <div className="flex rounded-full bg-surface p-1 ring-1 ring-line" role="group" aria-label="Date range">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={cx('rounded-full px-3 py-1 text-sm font-semibold', days === d ? 'bg-ink text-bg' : 'text-muted')}>Last {d} days</button>
            ))}
          </div>
        }
      />
      {q.isLoading ? <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24" />)}</div> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Dashboard s={q.data} />}
    </div>
  );
}

function Dashboard({ s }: { s: Stats }) {
  const k = s.kpi;
  return (
    <div className="space-y-4">
      {/* Hero + stat tiles */}
      <div className="grid gap-3 lg:grid-cols-4">
        <Card className="lg:col-span-1">
          <div className="text-sm text-muted">Revenue</div>
          <div className="mt-1 text-5xl font-semibold tracking-tight">{moneyCompact(k.revenue_cents, s.currency)}</div>
          <div className="mt-1 text-sm text-muted">{k.completed} completed orders</div>
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-3">
          <Tile label="Orders placed" value={compact(k.placed)} sub={`${k.cancelled} cancelled`} />
          <Tile label="Average basket" value={money(k.avg_basket_cents, s.currency)} />
          <Tile label="New customers" value={compact(k.new_customers)} />
          <Tile label="Points issued" value={compact(k.points_issued)} />
          <Tile label="Rewards redeemed" value={compact(k.rewards_used)} />
          <Tile label="Open orders" value={compact(s.openByStatus.reduce((n, r) => n + r.n, 0))} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-bold">Daily revenue</h2>
          <p className="mb-3 text-xs text-muted">By completion date</p>
          <ColumnChart data={s.daily.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.revenue_cents }))} format={(v) => money(v, s.currency)} axisFormat={(v) => moneyCompact(v, s.currency)} />
        </Card>
        <Card>
          <h2 className="font-bold">Orders per day</h2>
          <p className="mb-3 text-xs text-muted">By order date, including cancelled</p>
          <ColumnChart data={s.daily.map((d) => ({ key: d.day, label: dayLabel(d.day), value: d.orders }))} format={(v) => `${v} order${v === 1 ? '' : 's'}`} axisFormat={(v) => String(v)} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-bold">Popular products</h2>
          {s.topProducts.length === 0 ? <p className="text-sm text-muted">No completed orders in this period.</p> : (
            <ul className="space-y-2.5">
              {s.topProducts.map((p) => {
                const max = s.topProducts[0].quantity;
                return (
                  <li key={p.product_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
                    <span className="truncate font-semibold">{p.emoji} {p.name}</span>
                    <span className="tabular-nums text-muted">{p.quantity} sold · {money(p.revenue_cents, s.currency)}</span>
                    <span className="col-span-2 mt-1 h-2 rounded-full bg-surface-2">
                      <span className="block h-2 rounded-full" style={{ width: `${(p.quantity / max) * 100}%`, background: 'var(--viz-1)' }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-bold">Delivery vs pickup</h2>
            <SplitBar parts={s.fulfillmentMix.map((m) => ({ label: m.fulfillment_type === 'delivery' ? 'Delivery' : 'Pickup', value: m.n, color: m.fulfillment_type === 'delivery' ? 'var(--viz-1)' : 'var(--viz-2)' }))} />
          </Card>
          <Card>
            <h2 className="mb-2 font-bold">New sign-ups by QR source</h2>
            {s.signups.length === 0 ? <p className="text-sm text-muted">No sign-ups in this period.</p> : (
              <ul className="space-y-1.5 text-sm">{s.signups.map((r) => <li key={r.source} className="flex justify-between"><span className="capitalize">{r.source}</span><span className="font-semibold tabular-nums">{r.n}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold">Open orders by stage</h2>
          {s.openByStatus.length === 0 ? <p className="text-sm text-muted">Nothing open — all caught up.</p> : (
            <ul className="space-y-1.5 text-sm">{s.openByStatus.map((r) => <li key={r.status} className="flex justify-between"><span>{STATUS_META[r.status].emoji} {STATUS_META[r.status].label}</span><span className="font-semibold tabular-nums">{r.n}</span></li>)}</ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Low stock</h2>
          {s.lowStock.length === 0 ? <p className="text-sm text-muted">Everything is well stocked.</p> : (
            <ul className="space-y-1.5 text-sm">{s.lowStock.map((p) => <li key={p.id} className="flex justify-between"><span>{p.emoji} {p.name}</span><span className={cx('font-semibold tabular-nums', p.stock === 0 && 'text-rose-600')}>{p.stock === 0 ? '⚠ out' : `${p.stock} left`}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
}

/** Single-series column chart: thin bars, 4px rounded tops on a shared baseline, hairline grid, hover tooltip, table view. */
function ColumnChart({ data, format, axisFormat }: { data: { key: string; label: string; value: number }[]; format: (v: number) => string; axisFormat: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const H = 170;
  const W = 520;
  const left = 58;
  const T = 12; // top padding so the highest tick label isn't clipped
  const band = (W - left) / data.length;
  const barW = Math.min(24, band - 2);
  const y = (v: number) => T + H - (v / top) * H;

  if (table) {
    return (
      <div>
        <button className="mb-2 text-xs font-semibold text-brand" onClick={() => setTable(false)}>Show chart</button>
        <div className="max-h-56 overflow-y-auto text-sm">
          <table className="w-full"><tbody className="divide-y divide-line">{data.map((d) => <tr key={d.key}><td className="py-1 text-muted">{d.label}</td><td className="py-1 text-right font-semibold tabular-nums">{format(d.value)}</td></tr>)}</tbody></table>
        </div>
      </div>
    );
  }
  const labelEvery = Math.ceil(data.length / 7);
  return (
    <div className="relative">
      <button className="absolute -top-8 right-0 text-xs font-semibold text-brand" onClick={() => setTable(true)}>Table view</button>
      <svg viewBox={`0 0 ${W} ${T + H + 26}`} className="w-full" role="img" aria-label={`Column chart, ${data.length} days`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="13" fill="var(--muted)">{axisFormat(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * band + (band - barW) / 2;
          const h = Math.max(0, T + H - y(d.value));
          const base = T + H;
          const r = Math.min(4, h, barW / 2);
          return (
            <g key={d.key} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}>
              <rect x={left + i * band} y={0} width={band} height={base} fill="transparent" />
              {h > 0 && <path d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`} fill="var(--viz-1)" opacity={hover == null || hover === i ? 1 : 0.45} />}
              {i % labelEvery === 0 && <text x={left + i * band + band / 2} y={T + H + 20} textAnchor="middle" fontSize="13" fill="var(--muted)">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 rounded-xl bg-ink px-3 py-1.5 text-xs text-bg shadow-lg" style={{ left: `clamp(0px, calc(${((left + hover * band + band / 2) / W) * 100}% - 50px), calc(100% - 110px))` }}>
          <div className="font-semibold">{data[hover].label}</div>
          <div>{format(data[hover].value)}</div>
        </div>
      )}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Tall segmented bar for a 2-part share, with legend (identity never by colour alone). */
function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  if (!total) return <p className="text-sm text-muted">No orders in this period.</p>;
  return (
    <div>
      <div className="flex h-7 gap-[2px] overflow-hidden" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        {parts.map((p) => {
          const share = Math.round((p.value / total) * 100);
          return (
            <div key={p.label} className="flex items-center rounded px-2 text-xs font-semibold text-white" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.value} (${share}%)`}>
              {share >= 15 ? `${share}%` : ''}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-sm">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label} <span className="text-muted">{p.value}</span></span>
        ))}
      </div>
    </div>
  );
}
