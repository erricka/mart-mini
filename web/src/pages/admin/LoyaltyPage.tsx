import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, cx, ErrorState, Field, Input, Notice, Select, Sheet, Skeleton, Textarea, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fromCents, money, toCents } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { type AdminCoupon, type AdminReward, type LoyaltyData, PageHeader, settingsPayload, useIsAdmin, useLoyalty } from './common';

type Benefit = AdminReward['benefit'];
const DISCOUNT_TYPES = ['percent', 'fixed', 'free_delivery', 'free_product'] as const;

function useGiftProducts() {
  return useQuery({
    queryKey: ['admin', 'products', 'gift-picker'],
    queryFn: () => api<{ products: { id: number; name: string; emoji: string; stock: number }[] }>('/admin/products?includeInactive=false').then((r) => r.products),
    staleTime: 60_000,
  });
}

export function LoyaltyPage() {
  const { t } = useT();
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
      <PageHeader title={t('al.title')} subtitle={t('al.subtitle', { u: d.stats.unlocked, r: d.stats.used })} />
      {!isAdmin && <Notice tone="info">{t('al.readonly')}</Notice>}
      <EarningRules key={d.settings.updatedAt} data={d} disabled={!isAdmin} onSaved={refresh} />
      <Levels key={JSON.stringify(d.levels)} levels={d.levels} disabled={!isAdmin} onSaved={refresh} />
      <Milestones rewards={d.rewards} disabled={!isAdmin} onSaved={refresh} currency={d.settings.currency} />
      <Coupons coupons={d.coupons} disabled={!isAdmin} onSaved={refresh} currency={d.settings.currency} />
    </div>
  );
}

function EarningRules({ data, disabled, onSaved }: { data: LoyaltyData; disabled: boolean; onSaved: () => void }) {
  const { t } = useT();
  const s = data.settings;
  const [f, setF] = useState({
    pointsPerDollar: String(s.pointsPerDollar),
    signupBonusPoints: String(s.signupBonusPoints),
    welcomeCouponId: s.welcomeCouponId ? String(s.welcomeCouponId) : '',
    rewardExpiryDays: s.rewardExpiryDays ? String(s.rewardExpiryDays) : '',
  });
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
      toast(t('al.rules_saved'), 'success');
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card>
      <h2 className="text-lg font-bold">{t('al.earn_title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('al.earn_hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('al.points_per', { amount: money(100, s.currency) })}>
          <Input disabled={disabled} inputMode="numeric" value={f.pointsPerDollar} onChange={(e) => setF({ ...f, pointsPerDollar: e.target.value })} />
        </Field>
        <Field label={t('al.welcome_points')}>
          <Input disabled={disabled} inputMode="numeric" value={f.signupBonusPoints} onChange={(e) => setF({ ...f, signupBonusPoints: e.target.value })} />
        </Field>
        <Field label={t('al.welcome_coupon')}>
          <Select disabled={disabled} value={f.welcomeCouponId} onChange={(e) => setF({ ...f, welcomeCouponId: e.target.value })}>
            <option value="">{t('al.none')}</option>
            {data.coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('al.expiry')} hint={t('al.empty_never')}>
          <Input disabled={disabled} inputMode="numeric" value={f.rewardExpiryDays} onChange={(e) => setF({ ...f, rewardExpiryDays: e.target.value })} placeholder={t('al.never')} />
        </Field>
      </div>
      {!disabled && (
        <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>
          {t('al.save_rules')}
        </Button>
      )}
    </Card>
  );
}

function Levels({ levels, disabled, onSaved }: { levels: LoyaltyData['levels']; disabled: boolean; onSaved: () => void }) {
  const { t } = useT();
  const [rows, setRows] = useState(levels.map((l) => ({ ...l, nameEn: l.nameEn ?? '', multiplier: String(l.multiplierPercent / 100) })));
  const save = useMutation({
    mutationFn: () =>
      api('/admin/levels', {
        method: 'PUT',
        body: {
          levels: rows.map((r) => ({ name: r.name, nameEn: r.nameEn || null, emoji: r.emoji, minPoints: Number(r.minPoints) || 0, multiplierPercent: Math.round((Number(r.multiplier) || 1) * 100), color: r.color })),
        },
      }),
    onSuccess: () => {
      toast(t('al.levels_saved'), 'success');
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <Card>
      <h2 className="text-lg font-bold">{t('al.levels')}</h2>
      <p className="mb-4 text-sm text-muted">{t('al.levels_hint')}</p>
      <div className="space-y-2">
        <div className="hidden grid-cols-[60px_1fr_1fr_110px_90px_32px] gap-2 px-1 text-xs font-semibold text-muted md:grid">
          <span>{t('al.col_emoji')}</span>
          <span>{t('al.col_name')}</span>
          <span>{t('al.col_name_en')}</span>
          <span>{t('al.col_from')}</span>
          <span>{t('al.col_x')}</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[60px_1fr_90px] gap-2 rounded-2xl bg-surface-2 p-2 md:grid-cols-[60px_1fr_1fr_110px_90px_32px] md:bg-transparent md:p-0">
            <Input disabled={disabled} value={r.emoji} onChange={(e) => update(i, { emoji: e.target.value })} className="px-2 text-center" />
            <Input disabled={disabled} value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input disabled={disabled} value={r.nameEn} onChange={(e) => update(i, { nameEn: e.target.value })} placeholder="English" className="col-span-1 hidden md:block" />
            <Input disabled={disabled || i === 0} inputMode="numeric" value={r.minPoints} onChange={(e) => update(i, { minPoints: Number(e.target.value) || 0 })} />
            <Input disabled={disabled} inputMode="decimal" value={r.multiplier} onChange={(e) => update(i, { multiplier: e.target.value })} className="col-span-2 md:col-span-1" />
            {!disabled && i > 0 ? (
              <button className="text-muted" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('al.remove_level')}>
                ✕
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setRows([...rows, { id: 0, name: t('al.new_level'), nameEn: '', emoji: '⭐', minPoints: (rows.at(-1)?.minPoints ?? 0) + 500, multiplierPercent: 100, multiplier: '1', color: '#22c55e' }])
            }
          >
            {t('al.add_level')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('al.save_levels')}
          </Button>
        </div>
      )}
    </Card>
  );
}

type BenefitForm = { discountType: Benefit['discountType']; freeProductId: number | null; valueText: string; minText: string; maxText: string };

function BenefitFields({ b, onChange, currency }: { b: BenefitForm; onChange: (b: BenefitForm) => void; currency: string }) {
  const { t } = useT();
  const gifts = useGiftProducts();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t('al.reward_type')}>
        <Select value={b.discountType} onChange={(e) => onChange({ ...b, discountType: e.target.value as Benefit['discountType'] })}>
          {DISCOUNT_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`al.type_${k}` as TKey)}
            </option>
          ))}
        </Select>
      </Field>
      {b.discountType === 'percent' && (
        <Field label={t('al.percent_off')}>
          <Input inputMode="numeric" value={b.valueText} onChange={(e) => onChange({ ...b, valueText: e.target.value })} placeholder="10" />
        </Field>
      )}
      {b.discountType === 'fixed' && (
        <Field label={t('al.amount_off', { cur: currency })}>
          <Input inputMode="decimal" value={b.valueText} onChange={(e) => onChange({ ...b, valueText: e.target.value })} placeholder="5.00" />
        </Field>
      )}
      {b.discountType === 'free_product' && (
        <Field label={t('al.gift_product')}>
          <Select value={b.freeProductId ?? ''} onChange={(e) => onChange({ ...b, freeProductId: Number(e.target.value) || null })}>
            <option value="">{t('al.choose')}</option>
            {gifts.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name} {t('al.in_stock', { n: p.stock })}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t('al.min_basket', { cur: currency })} hint={t('al.zero_none')}>
        <Input inputMode="decimal" value={b.minText} onChange={(e) => onChange({ ...b, minText: e.target.value })} placeholder="0.00" />
      </Field>
      {b.discountType === 'percent' && (
        <Field label={t('al.max_discount', { cur: currency })} hint={t('al.optional_cap')}>
          <Input inputMode="decimal" value={b.maxText} onChange={(e) => onChange({ ...b, maxText: e.target.value })} placeholder={t('al.no_cap')} />
        </Field>
      )}
    </div>
  );
}

const benefitToForm = (b?: Partial<Benefit>): BenefitForm => ({
  discountType: b?.discountType ?? 'free_delivery',
  freeProductId: b?.freeProductId ?? null,
  valueText: b?.discountType === 'fixed' ? fromCents(b.value) : b?.value ? String(b.value) : '',
  minText: b?.minSubtotalCents ? fromCents(b.minSubtotalCents) : '',
  maxText: b?.maxDiscountCents ? fromCents(b.maxDiscountCents) : '',
});
const formToBenefit = (f: BenefitForm) => ({
  discountType: f.discountType,
  value: f.discountType === 'fixed' ? (toCents(f.valueText) ?? 0) : f.discountType === 'percent' ? Number(f.valueText) || 0 : 0,
  freeProductId: f.discountType === 'free_product' ? f.freeProductId : null,
  minSubtotalCents: toCents(f.minText || '0') ?? 0,
  maxDiscountCents: f.discountType === 'percent' && f.maxText ? toCents(f.maxText) : null,
});

interface MilestoneForm {
  id?: number;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  emoji: string;
  pointsRequired: string;
  isSurprise: boolean;
  active: boolean;
  benefit: BenefitForm;
}

function Milestones({ rewards, disabled, onSaved, currency }: { rewards: AdminReward[]; disabled: boolean; onSaved: () => void; currency: string }) {
  const { t } = useT();
  const [editing, setEditing] = useState<MilestoneForm | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const e = editing!;
      const body = {
        title: e.title,
        titleEn: e.titleEn || null,
        description: e.description,
        descriptionEn: e.descriptionEn || null,
        emoji: e.emoji || '🎁',
        pointsRequired: Number(e.pointsRequired),
        isSurprise: e.isSurprise,
        active: e.active,
        benefit: formToBenefit(e.benefit),
      };
      return e.id ? api(`/admin/rewards/${e.id}`, { method: 'PUT', body }) : api('/admin/rewards', { body });
    },
    onSuccess: () => {
      toast(t('al.milestone_saved'), 'success');
      setEditing(null);
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('al.milestones')}</h2>
          <p className="text-sm text-muted">{t('al.milestones_hint')}</p>
        </div>
        {!disabled && (
          <Button
            onClick={() =>
              setEditing({ title: '', titleEn: '', description: '', descriptionEn: '', emoji: '🎁', pointsRequired: String((rewards.at(-1)?.pointsRequired ?? 0) + 250), isSurprise: false, active: true, benefit: benefitToForm() })
            }
          >
            {t('al.add_milestone')}
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rewards.map((r) => (
          <div key={r.id} className={cx('flex items-center gap-3 rounded-2xl bg-surface-2 p-3', !r.active && 'opacity-50')}>
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-amber-50 text-2xl dark:bg-amber-500/15">{r.emoji}</div>
            <div className="min-w-0 flex-1">
              <div className="font-bold">
                {r.title} {r.isSurprise && <Badge className="bg-violet-100 text-violet-800">{t('al.surprise')}</Badge>}
              </div>
              <div className="text-xs text-muted">
                {r.pointsRequired} {t('al.pts')} · {r.benefit.label}
                {r.titleEn ? ` · ${r.titleEn}` : ''}
              </div>
            </div>
            {!disabled && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setEditing({
                    id: r.id,
                    title: r.title,
                    titleEn: r.titleEn ?? '',
                    description: r.description,
                    descriptionEn: r.descriptionEn ?? '',
                    emoji: r.emoji,
                    pointsRequired: String(r.pointsRequired),
                    isSurprise: r.isSurprise,
                    active: r.active,
                    benefit: benefitToForm(r.benefit),
                  })
                }
              >
                {t('common.edit')}
              </Button>
            )}
          </div>
        ))}
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('al.edit_milestone') : t('al.new_milestone')} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr_140px] gap-3">
              <Field label={t('al.col_emoji')}>
                <Input value={editing.emoji} onChange={(e) => setEditing({ ...editing, emoji: e.target.value })} />
              </Field>
              <Field label={t('al.title_km')}>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>
              <Field label={t('al.points_needed')}>
                <Input inputMode="numeric" value={editing.pointsRequired} onChange={(e) => setEditing({ ...editing, pointsRequired: e.target.value })} />
              </Field>
            </div>
            <Field label={t('al.title_en')}>
              <Input value={editing.titleEn} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} />
            </Field>
            <Field label={t('al.desc_km')}>
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label={t('al.desc_en')}>
              <Textarea value={editing.descriptionEn} onChange={(e) => setEditing({ ...editing, descriptionEn: e.target.value })} />
            </Field>
            <BenefitFields b={editing.benefit} onChange={(b) => setEditing({ ...editing, benefit: b })} currency={currency} />
            <div className="divide-y divide-line rounded-2xl bg-surface-2 px-4">
              <Toggle checked={editing.isSurprise} onChange={(v) => setEditing({ ...editing, isSurprise: v })} label={t('al.surprise_toggle')} hint={t('al.surprise_hint')} />
              <Toggle checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label={t('al.active')} />
            </div>
            <Button block size="lg" loading={save.isPending} disabled={!editing.title || !(Number(editing.pointsRequired) > 0)} onClick={() => save.mutate()}>
              {t('al.save_milestone')}
            </Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}

interface CouponForm {
  id?: number;
  code: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  perCustomerLimit: string;
  isPublic: boolean;
  active: boolean;
  benefit: BenefitForm;
}

function Coupons({ coupons, disabled, onSaved, currency }: { coupons: AdminCoupon[]; disabled: boolean; onSaved: () => void; currency: string }) {
  const { t } = useT();
  const [editing, setEditing] = useState<CouponForm | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const e = editing!;
      const body = {
        ...formToBenefit(e.benefit),
        code: e.code.trim() ? e.code.trim().toUpperCase() : null,
        title: e.title,
        titleEn: e.titleEn || null,
        description: e.description,
        descriptionEn: e.descriptionEn || null,
        startsAt: e.startsAt || null,
        endsAt: e.endsAt || null,
        maxRedemptions: e.maxRedemptions ? Number(e.maxRedemptions) : null,
        perCustomerLimit: e.perCustomerLimit ? Number(e.perCustomerLimit) : null,
        isPublic: e.isPublic,
        active: e.active,
      };
      return e.id ? api(`/admin/coupons/${e.id}`, { method: 'PUT', body }) : api('/admin/coupons', { body });
    },
    onSuccess: () => {
      toast(t('al.coupon_saved'), 'success');
      setEditing(null);
      onSaved();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const toDate = (s: string | null) => (s ? s.slice(0, 10) : '');
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{t('al.coupons')}</h2>
          <p className="text-sm text-muted">{t('al.coupons_hint')}</p>
        </div>
        {!disabled && (
          <Button
            onClick={() =>
              setEditing({ code: '', title: '', titleEn: '', description: '', descriptionEn: '', startsAt: '', endsAt: '', maxRedemptions: '', perCustomerLimit: '1', isPublic: true, active: true, benefit: benefitToForm({ discountType: 'fixed' }) })
            }
          >
            {t('al.new_coupon')}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-2">{t('al.col_coupon')}</th>
              <th>{t('al.col_code')}</th>
              <th>{t('al.col_benefit')}</th>
              <th>{t('al.col_used')}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {coupons.map((c) => (
              <tr key={c.id} className={cx(!c.active && 'opacity-50')}>
                <td className="py-2.5 font-semibold">
                  {c.title} {c.isWelcome && <Badge className="bg-emerald-100 text-emerald-800">{t('al.welcome_gift')}</Badge>} {c.isPublic && <Badge className="bg-sky-100 text-sky-800">{t('al.public')}</Badge>}
                </td>
                <td className="font-mono">{c.code ?? <span className="font-sans text-muted">{t('al.given_out')}</span>}</td>
                <td>
                  {c.benefit}
                  {c.minSubtotalCents ? t('al.min', { amount: money(c.minSubtotalCents) }) : ''}
                </td>
                <td>
                  {c.redeemedCount}
                  {c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''}
                </td>
                <td className="text-right">
                  {!disabled && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          code: c.code ?? '',
                          title: c.title,
                          titleEn: c.titleEn ?? '',
                          description: c.description,
                          descriptionEn: c.descriptionEn ?? '',
                          startsAt: toDate(c.startsAt),
                          endsAt: toDate(c.endsAt),
                          maxRedemptions: c.maxRedemptions ? String(c.maxRedemptions) : '',
                          perCustomerLimit: c.perCustomerLimit ? String(c.perCustomerLimit) : '',
                          isPublic: c.isPublic,
                          active: c.active,
                          benefit: benefitToForm(c),
                        })
                      }
                    >
                      {t('common.edit')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('al.edit_coupon') : t('al.new_coupon_title')} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('al.title_km')}>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder={t('al.coupon_title_ph')} />
              </Field>
              <Field label={t('al.title_en')}>
                <Input value={editing.titleEn} onChange={(e) => setEditing({ ...editing, titleEn: e.target.value })} />
              </Field>
              <Field label={t('al.code')} hint={t('al.code_hint')}>
                <Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="font-mono uppercase" placeholder="FRESH5" />
              </Field>
            </div>
            <Field label={t('al.description')}>
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label={t('al.desc_en')}>
              <Input value={editing.descriptionEn} onChange={(e) => setEditing({ ...editing, descriptionEn: e.target.value })} />
            </Field>
            <BenefitFields b={editing.benefit} onChange={(b) => setEditing({ ...editing, benefit: b })} currency={currency} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label={t('al.starts')}>
                <Input type="date" value={editing.startsAt} onChange={(e) => setEditing({ ...editing, startsAt: e.target.value })} />
              </Field>
              <Field label={t('al.ends')}>
                <Input type="date" value={editing.endsAt} onChange={(e) => setEditing({ ...editing, endsAt: e.target.value })} />
              </Field>
              <Field label={t('al.total_uses')}>
                <Input inputMode="numeric" value={editing.maxRedemptions} onChange={(e) => setEditing({ ...editing, maxRedemptions: e.target.value })} placeholder="∞" />
              </Field>
              <Field label={t('al.per_customer')}>
                <Input inputMode="numeric" value={editing.perCustomerLimit} onChange={(e) => setEditing({ ...editing, perCustomerLimit: e.target.value })} placeholder="∞" />
              </Field>
            </div>
            <div className="divide-y divide-line rounded-2xl bg-surface-2 px-4">
              <Toggle checked={editing.isPublic} onChange={(v) => setEditing({ ...editing, isPublic: v })} label={t('al.show_all')} hint={t('al.show_all_hint')} />
              <Toggle checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} label={t('al.active')} />
            </div>
            <Button block size="lg" loading={save.isPending} disabled={!editing.title} onClick={() => save.mutate()}>
              {t('al.save_coupon')}
            </Button>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
