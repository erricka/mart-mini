import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Button, Card, ErrorState, Field, Input, Notice, Skeleton, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fromCents, toCents } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { type LoyaltyData, PageHeader, settingsPayload, useIsAdmin, useLoyalty } from './common';

export function SettingsPage() {
  const q = useLoyalty();
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <SettingsForm key={q.data.settings.updatedAt} data={q.data} />;
}

function SettingsForm({ data }: { data: LoyaltyData }) {
  const { t } = useT();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const s = data.settings;
  const [f, setF] = useState({
    shopName: s.shopName,
    tagline: s.tagline,
    taglineEn: s.taglineEn ?? '',
    currency: s.currency,
    supportPhone: s.supportPhone,
    deliveryEnabled: s.deliveryEnabled,
    pickupEnabled: s.pickupEnabled,
    pickupAddress: s.pickupAddress,
    pickupHours: s.pickupHours,
    deliveryFee: fromCents(s.deliveryFeeCents),
    freeDeliveryMin: s.freeDeliveryMinCents == null ? '' : fromCents(s.freeDeliveryMinCents),
    minOrder: fromCents(s.minOrderCents),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: () =>
      api('/admin/settings', {
        method: 'PUT',
        body: settingsPayload(s, {
          shopName: f.shopName,
          tagline: f.tagline,
          taglineEn: f.taglineEn || null,
          currency: f.currency.toUpperCase(),
          supportPhone: f.supportPhone,
          deliveryEnabled: f.deliveryEnabled,
          pickupEnabled: f.pickupEnabled,
          deliveryFeeCents: toCents(f.deliveryFee) ?? 0,
          freeDeliveryMinCents: f.freeDeliveryMin === '' ? null : toCents(f.freeDeliveryMin),
          minOrderCents: toCents(f.minOrder) ?? 0,
          pickupAddress: f.pickupAddress,
          pickupHours: f.pickupHours,
        }),
      }),
    onSuccess: () => {
      toast(t('as.saved'), 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'loyalty'] });
      qc.invalidateQueries({ queryKey: ['shop'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const d = !isAdmin;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('as.title')}
        actions={
          isAdmin && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('as.save')}
            </Button>
          )
        }
      />
      {!isAdmin && <Notice tone="info">{t('as.readonly')}</Notice>}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-bold">🌐 {t('as.language')}</span>
        <LanguageSwitch />
      </Card>

      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">{t('as.shop')}</h2>
        <Field label={t('as.shop_name')}>
          <Input disabled={d} value={f.shopName} onChange={(e) => set('shopName', e.target.value)} />
        </Field>
        <Field label={t('as.support_phone')}>
          <Input disabled={d} value={f.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} />
        </Field>
        <Field label={t('as.tagline')}>
          <Input disabled={d} value={f.tagline} onChange={(e) => set('tagline', e.target.value)} />
        </Field>
        <Field label={t('as.tagline_en')}>
          <Input disabled={d} value={f.taglineEn} onChange={(e) => set('taglineEn', e.target.value)} />
        </Field>
        <Field label={t('as.currency')} hint={t('as.currency_hint')}>
          <Input disabled={d} value={f.currency} onChange={(e) => set('currency', e.target.value)} maxLength={3} className="uppercase" />
        </Field>
      </Card>

      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">{t('as.fulfilment')}</h2>
        <div className="sm:col-span-2">
          <Toggle checked={f.deliveryEnabled} onChange={(v) => !d && set('deliveryEnabled', v)} label={t('as.offer_delivery')} />
        </div>
        <Field label={t('as.delivery_fee')}>
          <Input disabled={d || !f.deliveryEnabled} inputMode="decimal" value={f.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} />
        </Field>
        <Field label={t('as.free_from')} hint={t('as.empty_never')}>
          <Input disabled={d || !f.deliveryEnabled} inputMode="decimal" value={f.freeDeliveryMin} onChange={(e) => set('freeDeliveryMin', e.target.value)} />
        </Field>
        <Field label={t('as.min_order')}>
          <Input disabled={d} inputMode="decimal" value={f.minOrder} onChange={(e) => set('minOrder', e.target.value)} />
        </Field>
        <div />
        <div className="sm:col-span-2">
          <Toggle checked={f.pickupEnabled} onChange={(v) => !d && set('pickupEnabled', v)} label={t('as.offer_pickup')} />
        </div>
        <Field label={t('as.pickup_point')}>
          <Input disabled={d || !f.pickupEnabled} value={f.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} />
        </Field>
        <Field label={t('as.pickup_hours')}>
          <Input disabled={d || !f.pickupEnabled} value={f.pickupHours} onChange={(e) => set('pickupHours', e.target.value)} />
        </Field>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-bold">{t('as.payments')}</h2>
        <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3.5">
          <span className="text-2xl">💵</span>
          <p className="text-sm">{t('as.payments_text')}</p>
        </div>
        <p className="mt-2 text-xs text-muted">{t('as.online_later')}</p>
      </Card>
    </div>
  );
}
