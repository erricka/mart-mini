import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, cx, ErrorState, Field, Input, Notice, Select, Sheet, Skeleton, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fromCents, money, toCents } from '../../lib/format';
import { toast } from '../../lib/toast';
import type { Level } from '../../lib/types';
import { type AdminCoupon, type AdminReward, PageHeader, settingsPayload, useIsAdmin, useLoyalty } from './common';

type Benefit = AdminReward['benefit'];
const DISCOUNT_LABEL = { percent: '% off basket', fixed: 'Amount off', free_delivery: 'Free delivery', free_product: 'Free product (gift)' } as const;

function useGiftProducts() {
  return useQuery({
    queryKey: ['admin', 'products', 'gift-picker'],
    queryFn: () => api<{ products: { id: number; name: string; emoji: string; stock: number }[] }>('/admin/products?includeInactive=false').then((r) => r.products),
    staleTime: 60_000,
  });
}

export function LoyaltyPage() {
  const isAdmin = useIsAdmin();
  const q = useLoyalty();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'loyalty'] });
    qc.invalidateQueries({ queryKey: ['shop'] });
  };
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Loyalty" subtitle={`${d.stats.unlocked} rewards unlocked by customers · ${d.stats.used} redeemed`} />
      {!isAdmin && <Notice tone="info">You can view the loyalty setup. Only shop admins can change it.</Notice>}
      <EarningRules key={d.settings.updatedAt} data={d} disabled={!isAdmin} onSaved={refresh} />
      <Levels key={JSON.stringify(d.levels)} levels={d.levels} disabled={!isAdmin} onSaved={refresh} />
      <Milestones rewards={d.rewards} disabled={!isAdmin} onSaved={refresh} />
      <Coupons coupons={d.coupons} disabled={!isAdmin} onSaved={refresh} />
    </div>
  );
}

function EarningRules({ data, disabled, onSaved }: { data: ReturnType<typeof useLoyalty>['data'] & {}; disabled: boolean; onSaved: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({ pointsPerDollar: String(s.pointsPerDollar), signupBonusPoints: String(s.signupBonusPoints), welcomeCouponId: s.welcomeCouponId ? String(s.welcomeCouponId) : '', rewardExpiryDays: s.rewardExpiryDays ? String(s.rewardExpiryDays) : '' });
  const save = useMutation({
    mutationFn: () =>
      api('/admin/settings', {
        method: 'PUT',
        body: settingsPayload(s, {
          pointsPerDollar: Number(f.pointsPerDollar) || 0,
          signupBonusPoints: Number(f.signupBonusPoints) || 0,
          welcomeCouponId: f.welcomeCouponId ? Number(f.welcomeCouponId) : null,
          rewardExpiryDays: f.rewardExpiryDays ? Number(f.rewardExpiryDays) : null,
        }),
      }),
    onSuccess: () => {
      toast('Earning rules saved ✓', 'success');
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card>
      <h2 className="text-lg font-bold">How customers earn</h2>
      <p className="mb-4 text-sm text-muted">Purchase points are credited only when an order is delivered or collected, and reversed automatically on refunds.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={`Points per ${money(100, s.currency)} spent`}><Input disabled={disabled} inputMode="numeric" value={f.pointsPerDollar} onChange={(e) => setF({ ...f, pointsPerDollar: e.target.value })} /></Field>
        <Field label="Welcome bonus points"><Input disabled={disabled} inputMode="numeric" value={f.signupBonusPoints} onChange={(e) => setF({ ...f, signupBonusPoints: e.target.value })} /></Field>
        <Field label="Welcome coupon">
          <Select disabled={disabled} value={f.welcomeCouponId} onChange={(e) => setF({ ...f, welcomeCouponId: e.target.value })}>
            <option value="">None</option>
            {data.coupons.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        </Field>
        <Field label="Rewards expire after (days)" hint="Empty = never"><Input disabled={disabled} inputMode="numeric" value={f.rewardExpiryDays} onChange={(e) => setF({ ...f, rewardExpiryDays: e.target.value })} placeholder="never" /></Field>
      </div>
      {!disabled && <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>Save earning rules</Button>}
    </Card>
  );
}

function Levels({ levels, disabled, onSaved }: { levels: Level[]; disabled: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState(levels.map((l) => ({ ...l, multiplier: String(l.multiplierPercent / 100) })));
  const save = useMutation({
    mutationFn: () => api('/admin/levels', { method: 'PUT', body: { levels: rows.map((r) => ({ name: r.name, emoji: r.emoji, minPoints: Number(r.minPoints) || 0, multiplierPercent: Math.round((Number(r.multiplier) || 1) * 100), color: r.color })) } }),
    onSuccess: () => {
      toast('Levels saved ✓', 'success');
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <Card>
      <h2 className="text-lg font-bold">Membership levels</h2>
      <p className="mb-4 text-sm text-muted">Levels are based on total points. Higher levels can earn points faster.</p>
      <div className="space-y-2">
        <div className="hidden grid-cols-[60px_1fr_120px_120px_40px] gap-2 px-1 text-xs font-semibold text-muted sm:grid"><span>Emoji</span><span>Name</span><span>From points</span><span>Points ×</span><span /></div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_90px] gap-2 sm:grid-cols-[60px_1fr_120px_120px_40px]">
            <Input disabled={disabled} value={r.emoji} onChange={(e) => update(i, { emoji: e.target.value })} className="px-2 text-center" />
            <Input disabled={disabled} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input disabled={disabled || i === 0} inputMode="numeric" value={r.minPoints} onChange={(e) => update(i, { minPoints: Number(e.target.value) || 0 })} />
            <Input disabled={disabled} inputMode="decimal" value={r.multiplier} onChange={(e) => update(i, { multiplier: e.target.value })} />
            {!disabled && i > 0 ? <button className="text-muted" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label="Remove level">✕</button> : <span />}
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setRows([...rows, { id: 0, name: 'New level', emoji: '⭐', minPoints: (rows.at(-1)?.minPoints ?? 0) + 500, multiplierPercent: 100, multiplier: '1', color: '#22c55e' }])}>+ Add level</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save levels</Button>
        </div>
      )}
    </Card>
  );
}

function BenefitFields({ b, onChange, disabled, currency = 'USD' }: { b: Partial<Benefit> & { valueText?: string; minText?: string; maxText?: string }; onChange: (b: any) => void; disabled?: boolean; currency?: string }) {
  const gifts = useGiftProducts();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Reward type">
        <Select disabled={disabled} value={b.discountType} onChange={(e) => onChange({ ...b, discountType: e.target.value })}>
          {Object.entries(DISCOUNT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      {b.discountType === 'percent' && <Field label="Percent off"><Input disabled={disabled} inputMode="numeric" value={b.valueText ?? ''} onChange={(e) => onChange({ ...b, valueText: e.target.value })} placeholder="10" /></Field>}
      {b.discountType === 'fixed' && <Field label={`Amount off (${currency})`}><Input disabled={disabled} inputMode="decimal" value={b.valueText ?? ''} onChange={(e) => onChange({ ...b, valueText: e.target.value })} placeholder="5.00" /></Field>}
      {b.discountType === 'free_product' && (
        <Field label="Gift product">
          <Select disabled={disabled} value={b.freeProductId ?? ''} onChange={(e) => onChange({ ...b, freeProductId: Number(e.target.value) || null })}>
            <option value="">Choose…</option>
            {gifts.data?.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.name} ({p.stock} in stock)</option>)}
          </Select>
        </Field>
      )}
      <Field label={`Minimum basket (${currency})`} hint="0 = no minimum"><Input disabled={disabled} inputMode="decimal" value={b.minText ?? ''} onChange={(e) => onChange({ ...b, minText: e.target.value })} placeholder="0.00" /></Field>
      {b.discountType === 'percent' && <Field label={`Max discount (${currency})`} hint="Optional cap"><Input disabled={disabled} inputMode="decimal" value={b.maxText ?? ''} onChange={(e) => onChange({ ...b, maxText: e.target.value })} placeholder="no cap" /></Field>}
    </div>
  );
}

const benefitToForm = (b?: Partial<Benefit>) => ({
  discountType: b?.discountType ?? 'free_delivery',
  freeProductId: b?.freeProductId ?? null,
  valueText: b?.discountType === 'fixed' ? fromCents(b.value) : b?.value ? String(b.value) : '',
  minText: b?.minSubtotalCents ? fromCents(b.minSubtotalCents) : '',
  maxText: b?.maxDiscountCents ? fromCents(b.maxDiscountCents) : '',
});
const formToBenefit = (f: ReturnType<typeof benefitToForm>) => ({
  discountType: f.discountType,
  value: f.discountType === 'fixed' ? (toCents(f.valueText) ?? 0) : f.discountType === 'percent' ? Number(f.valueText) || 0 : 0,
  freeProductId: f.discountType === 'free_product' ? f.freeProductId : null,
  minSubtotalCents: toCents(f.minText || '0') ?? 0,
  maxDiscountCents: f.discountType === 'percent' && f.maxText ? toCents(f.maxText) : null,
});

function Milestones({ rewards, disabled, onSaved }: { rewards: AdminReward[]; disabled: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<any>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { title: editing.title, description: editing.description ?? '', emoji: editing.emoji || '🎁', pointsRequired: Number(editing.pointsRequired), isSurprise: !!editing.isSurprise, active: editing.active ?? true, benefit: formToBenefit(editing.benefit) };
      return editing.id ? api(`/admin/rewards/${editing.id}`, { method: 'PUT', body }) : api('/admin/rewards', { body });
    },
    onSuccess: () => {
      toast('Milestone saved ✓', 'success');
      setEditing(null);
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Milestone rewards</h2>
          <p className="text-sm text-muted">Reaching a points milestone unlocks the reward once. Customers redeem it at checkout.</p>
        </div>
        {!disabled && <Button onClick={() => setEditing({ emoji: '🎁', active: true, pointsRequired: (rewards.at(-1)?.pointsRequired ?? 0) + 250, benefit: benefitToForm() })}>+ Add milestone</Button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rewards.map((r) => (
          <div key={r.id} className={cx('flex items-center gap-3 rounded-2xl bg-surface-2 p-3', !r.active && 'opacity-50')}>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-amber-200 to-orange-300 text-2xl">{r.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{r.title} {r.isSurprise && <Badge className="bg-violet-100 text-violet-800">surprise</Badge>}</div>
              <div className="text-xs text-muted">{r.pointsRequired} pts · {r.benefit.label}</div>
            </div>
            {!disabled && <Button size="sm" variant="secondary" onClick={() => setEditing({ ...r, benefit: benefitToForm(r.benefit) })}>Edit</Button>}
          </div>
        ))}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit milestone' : 'New milestone'} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr_140px] gap-3">
              <Field label="Emoji"><Input value={editing.emoji} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} /></Field>
              <Field label="Title"><Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Free delivery" /></Field>
              <Field label="Points needed"><Input inputMode="numeric" value={editing.pointsRequired} onChange={(e) => setEditing({ ...editing, pointsRequired: e.target.value })} /></Field>
            </div>
            <Field label="Description (shown after unlocking)"><Textarea value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <BenefitFields b={editing.benefit} onChange={(b) => setEditing({ ...editing, benefit: b })} />
            <div className="divide-y divide-line rounded-2xl bg-surface-2 px-4">
              <Toggle checked={!!editing.isSurprise} onChange={(v) => setEditing({ ...editing, isSurprise: v })} label="Surprise" hint="Hide what it is until the customer unlocks it." />
              <Toggle checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Active" />
            </div>
            <Button block size="lg" loading={save.isPending} disabled={!editing.title || !(Number(editing.pointsRequired) > 0)} onClick={() => save.mutate()}>Save milestone</Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}

function Coupons({ coupons, disabled, onSaved }: { coupons: AdminCoupon[]; disabled: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<any>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...formToBenefit(editing.benefit),
        code: editing.code?.trim() ? editing.code.trim().toUpperCase() : null,
        title: editing.title,
        description: editing.description ?? '',
        startsAt: editing.startsAt || null,
        endsAt: editing.endsAt || null,
        maxRedemptions: editing.maxRedemptions ? Number(editing.maxRedemptions) : null,
        perCustomerLimit: editing.perCustomerLimit ? Number(editing.perCustomerLimit) : null,
        isPublic: !!editing.isPublic,
        active: editing.active ?? true,
      };
      return editing.id ? api(`/admin/coupons/${editing.id}`, { method: 'PUT', body }) : api('/admin/coupons', { body });
    },
    onSuccess: () => {
      toast('Coupon saved ✓', 'success');
      setEditing(null);
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const toDate = (s: string | null) => (s ? s.slice(0, 10) : '');
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Coupons</h2>
          <p className="text-sm text-muted">Public codes anyone can use, plus coupons you hand out (like the welcome gift).</p>
        </div>
        {!disabled && <Button onClick={() => setEditing({ active: true, isPublic: true, perCustomerLimit: '1', benefit: benefitToForm({ discountType: 'fixed' }) })}>+ New coupon</Button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase text-muted"><tr><th className="py-2">Coupon</th><th>Code</th><th>Benefit</th><th>Used</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {coupons.map((c) => (
              <tr key={c.id} className={cx(!c.active && 'opacity-50')}>
                <td className="py-2.5 font-semibold">{c.title} {c.isWelcome && <Badge className="bg-emerald-100 text-emerald-800">welcome gift</Badge>} {c.isPublic && <Badge className="bg-sky-100 text-sky-800">public</Badge>}</td>
                <td className="font-mono">{c.code ?? <span className="font-sans text-muted">— (given out)</span>}</td>
                <td>{c.benefit}{c.minSubtotalCents ? ` · min ${money(c.minSubtotalCents)}` : ''}</td>
                <td>{c.redeemedCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}</td>
                <td className="text-right">{!disabled && <Button size="sm" variant="secondary" onClick={() => setEditing({ ...c, startsAt: toDate(c.startsAt), endsAt: toDate(c.endsAt), maxRedemptions: c.maxRedemptions ?? '', perCustomerLimit: c.perCustomerLimit ?? '', benefit: benefitToForm(c) })}>Edit</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit coupon' : 'New coupon'} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title"><Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="$5 off orders over $40" /></Field>
              <Field label="Code" hint="Leave empty for coupons you only give out (e.g. welcome gift)."><Input value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="font-mono uppercase" placeholder="FRESH5" /></Field>
            </div>
            <Field label="Description"><Input value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <BenefitFields b={editing.benefit} onChange={(b) => setEditing({ ...editing, benefit: b })} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Starts"><Input type="date" value={editing.startsAt ?? ''} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} /></Field>
              <Field label="Ends"><Input type="date" value={editing.endsAt ?? ''} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value })} /></Field>
              <Field label="Total uses"><Input inputMode="numeric" value={editing.maxRedemptions ?? ''} onChange={(e) => setEditing({ ...editing, maxRedemptions: e.target.value })} placeholder="∞" /></Field>
              <Field label="Per customer"><Input inputMode="numeric" value={editing.perCustomerLimit ?? ''} onChange={(e) => setEditing({ ...editing, perCustomerLimit: e.target.value })} placeholder="∞" /></Field>
            </div>
            <div className="divide-y divide-line rounded-2xl bg-surface-2 px-4">
              <Toggle checked={!!editing.isPublic} onChange={(v) => setEditing({ ...editing, isPublic: v })} label="Show to all customers" hint="Listed in Rewards and at checkout (needs a code)." />
              <Toggle checked={editing.active ?? true} onChange={(v) => setEditing({ ...editing, active: v })} label="Active" />
            </div>
            <Button block size="lg" loading={save.isPending} disabled={!editing.title} onClick={() => save.mutate()}>Save coupon</Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
