import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { Button, Card, ErrorState, Field, Input, Notice, Skeleton, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fromCents, money, toCents } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import type { LatLng } from '../../lib/types';
import { type LoyaltyData, PageHeader, settingsPayload, useIsAdmin, useLoyalty } from './common';

const MapPicker = lazy(() => import('../../components/MapPicker'));

/** Same formula as the server (services/pricing.ts) for the example table. */
function exampleFee(km: number, base: number, perKm: number, min: number, currency: string) {
  const step = currency === 'KHR' ? 10_000 : 5;
  return Math.ceil(Math.max(min, base + perKm * km) / step) * step;
}

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
    byDistance: s.deliveryPricing !== 'flat',
    storeMapsUrl: s.storeMapsUrl ?? '',
    base: fromCents(s.deliveryBaseCents),
    perKm: fromCents(s.deliveryPerKmCents),
    minFee: fromCents(s.deliveryMinFeeCents),
    maxKm: s.deliveryMaxKm == null ? '' : String(s.deliveryMaxKm),
    nextDayEnabled: s.nextDayEnabled,
    nextDayFee: fromCents(s.nextDayFeeCents),
  });
  const [storePin, setStorePin] = useState<LatLng | null>(s.storeLat != null && s.storeLng != null ? { lat: s.storeLat, lng: s.storeLng } : null);
  const locate = useMutation({
    mutationFn: () => api<{ pin: LatLng }>('/admin/settings/locate', { body: { input: f.storeMapsUrl } }),
    onSuccess: ({ pin }) => {
      setStorePin(pin);
      toast(t('as.dm_found'), 'success');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
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
          deliveryPricing: f.byDistance ? 'distance' : 'flat',
          storeLat: storePin?.lat ?? null,
          storeLng: storePin?.lng ?? null,
          storeMapsUrl: f.storeMapsUrl.trim() || null,
          deliveryBaseCents: toCents(f.base) ?? 0,
          deliveryPerKmCents: toCents(f.perKm) ?? 0,
          deliveryMinFeeCents: toCents(f.minFee) ?? 0,
          deliveryMaxKm: f.maxKm.trim() === '' ? null : Math.max(1, Math.round(Number(f.maxKm)) || 1),
          nextDayEnabled: f.nextDayEnabled,
          nextDayFeeCents: toCents(f.nextDayFee) ?? 0,
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
        <Field label={t('as.delivery_fee')} hint={t('as.dm_flat_hint')}>
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

      {f.deliveryEnabled && (
        <Card className="space-y-4">
          <h2 className="text-lg font-bold">{t('as.dm_title')}</h2>
          <Toggle checked={f.byDistance} onChange={(v) => !d && set('byDistance', v)} label={t('as.dm_by_distance')} hint={t('as.dm_by_distance_hint')} />

          <div className="space-y-2">
            <div className="font-semibold">{t('as.dm_store')}</div>
            <p className="text-sm text-muted">{t('as.dm_store_hint')}</p>
            {!storePin && <Notice tone="warn">{t('as.dm_no_store')}</Notice>}
            <div className="flex gap-2">
              <Input disabled={d} value={f.storeMapsUrl} onChange={(e) => set('storeMapsUrl', e.target.value)} placeholder={t('as.dm_paste')} />
              <Button variant="secondary" disabled={d || f.storeMapsUrl.trim().length < 3} loading={locate.isPending} onClick={() => locate.mutate()}>
                {t('as.dm_find')}
              </Button>
            </div>
            <Suspense fallback={<Skeleton className="h-[300px] rounded-3xl" />}>
              <MapPicker value={storePin} onChange={(p) => !d && setStorePin(p)} pinEmoji="🏪" height={300} hint={t('as.dm_store_hint')} />
            </Suspense>
            {storePin && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="tabular-nums">📍 {storePin.lat.toFixed(6)}, {storePin.lng.toFixed(6)}</span>
                <a className="font-semibold text-brand" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${storePin.lat},${storePin.lng}`}>
                  {t('as.dm_check')}
                </a>
              </div>
            )}
          </div>

          {f.byDistance && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('as.dm_base')}>
                  <Input disabled={d} inputMode="decimal" value={f.base} onChange={(e) => set('base', e.target.value)} />
                </Field>
                <Field label={t('as.dm_per_km')}>
                  <Input disabled={d} inputMode="decimal" value={f.perKm} onChange={(e) => set('perKm', e.target.value)} />
                </Field>
                <Field label={t('as.dm_min')}>
                  <Input disabled={d} inputMode="decimal" value={f.minFee} onChange={(e) => set('minFee', e.target.value)} />
                </Field>
                <Field label={t('as.dm_max_km')} hint={t('as.dm_max_km_hint')}>
                  <Input disabled={d} inputMode="numeric" value={f.maxKm} onChange={(e) => set('maxKm', e.target.value.replace(/[^\d]/g, ''))} />
                </Field>
              </div>
              <div className="rounded-2xl bg-surface-2 p-3.5">
                <div className="mb-2 text-sm font-semibold">{t('as.dm_examples')}</div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[1, 3, 5, 10].map((km) => (
                    <div key={km} className="rounded-xl bg-surface p-2">
                      <div className="text-xs text-muted">{t('as.dm_km', { km })}</div>
                      <div className="font-bold tabular-nums">
                        {money(exampleFee(km, toCents(f.base) ?? 0, toCents(f.perKm) ?? 0, toCents(f.minFee) ?? 0, f.currency.toUpperCase()), f.currency.toUpperCase())}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">{t('as.dm_rates_note')}</p>
              </div>
            </>
          )}

          <div className="border-t border-line pt-3">
            <Toggle checked={f.nextDayEnabled} onChange={(v) => !d && set('nextDayEnabled', v)} label={t('as.dm_next_day')} hint={t('as.dm_next_day_hint')} />
            {f.nextDayEnabled && (
              <div className="mt-2 max-w-xs">
                <Field label={t('as.dm_next_day_fee')}>
                  <Input disabled={d} inputMode="decimal" value={f.nextDayFee} onChange={(e) => set('nextDayFee', e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        </Card>
      )}

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
