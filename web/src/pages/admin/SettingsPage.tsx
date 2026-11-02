import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Select, Skeleton, Toggle } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { fromCents, toCents } from '../../lib/format';
import { toast } from '../../lib/toast';
import { type LoyaltyData, PageHeader, settingsPayload, useIsAdmin, useLoyalty } from './common';

export function SettingsPage() {
  const q = useLoyalty();
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <SettingsForm key={q.data.settings.updatedAt} data={q.data} />;
}

function SettingsForm({ data }: { data: LoyaltyData }) {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const s = data.settings;
  const [f, setF] = useState({
    ...s,
    deliveryFee: fromCents(s.deliveryFeeCents),
    freeDeliveryMin: s.freeDeliveryMinCents == null ? '' : fromCents(s.freeDeliveryMinCents),
    minOrder: fromCents(s.minOrderCents),
    window: String(s.paymentWindowMinutes),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });
  const save = useMutation({
    mutationFn: () =>
      api('/admin/settings', {
        method: 'PUT',
        body: settingsPayload(s, {
          shopName: f.shopName,
          tagline: f.tagline,
          currency: f.currency.toUpperCase(),
          supportPhone: f.supportPhone,
          deliveryEnabled: f.deliveryEnabled,
          pickupEnabled: f.pickupEnabled,
          deliveryFeeCents: toCents(f.deliveryFee) ?? 0,
          freeDeliveryMinCents: f.freeDeliveryMin === '' ? null : toCents(f.freeDeliveryMin),
          minOrderCents: toCents(f.minOrder) ?? 0,
          pickupAddress: f.pickupAddress,
          pickupHours: f.pickupHours,
          cashEnabled: f.cashEnabled,
          qrPaymentMode: f.qrPaymentMode,
          qrPaymentInstructions: f.qrPaymentInstructions,
          paymentWindowMinutes: Number(f.window) || 30,
        }),
      }),
    onSuccess: () => {
      toast('Settings saved ✓', 'success');
      qc.invalidateQueries({ queryKey: ['admin', 'loyalty'] });
      qc.invalidateQueries({ queryKey: ['shop'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const providers = data.paymentProviders;
  const d = !isAdmin;

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" actions={isAdmin && <Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>} />
      {!isAdmin && <Notice tone="info">Only shop admins can change settings.</Notice>}

      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">Shop</h2>
        <Field label="Shop name"><Input disabled={d} value={f.shopName} onChange={(e) => set('shopName', e.target.value)} /></Field>
        <Field label="Tagline"><Input disabled={d} value={f.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label="Currency" hint="3-letter code, e.g. USD or KHR"><Input disabled={d} value={f.currency} onChange={(e) => set('currency', e.target.value)} maxLength={3} className="uppercase" /></Field>
        <Field label="Support phone"><Input disabled={d} value={f.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} /></Field>
      </Card>

      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">Delivery & pickup</h2>
        <div className="sm:col-span-2"><Toggle checked={f.deliveryEnabled} onChange={(v) => !d && set('deliveryEnabled', v)} label="Offer delivery" /></div>
        <Field label="Delivery fee"><Input disabled={d || !f.deliveryEnabled} inputMode="decimal" value={f.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} /></Field>
        <Field label="Free delivery from" hint="Empty = never free"><Input disabled={d || !f.deliveryEnabled} inputMode="decimal" value={f.freeDeliveryMin} onChange={(e) => set('freeDeliveryMin', e.target.value)} /></Field>
        <Field label="Minimum order"><Input disabled={d} inputMode="decimal" value={f.minOrder} onChange={(e) => set('minOrder', e.target.value)} /></Field>
        <div />
        <div className="sm:col-span-2"><Toggle checked={f.pickupEnabled} onChange={(v) => !d && set('pickupEnabled', v)} label="Offer pickup at the store" /></div>
        <Field label="Pickup point"><Input disabled={d || !f.pickupEnabled} value={f.pickupAddress} onChange={(e) => set('pickupAddress', e.target.value)} /></Field>
        <Field label="Pickup hours"><Input disabled={d || !f.pickupEnabled} value={f.pickupHours} onChange={(e) => set('pickupHours', e.target.value)} /></Field>
      </Card>

      <Card className="grid gap-3 sm:grid-cols-2">
        <h2 className="text-lg font-bold sm:col-span-2">Payments</h2>
        <div className="sm:col-span-2"><Toggle checked={f.cashEnabled} onChange={(v) => !d && set('cashEnabled', v)} label="Cash on delivery / at pickup" hint="Order goes to the shop right away; staff mark it paid when collected." /></div>
        <Field label="QR payment" hint="QR orders reach the shop only after the payment is confirmed.">
          <Select disabled={d} value={f.qrPaymentMode} onChange={(e) => set('qrPaymentMode', e.target.value as typeof f.qrPaymentMode)}>
            <option value="off">Off</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>{p.label}{p.configured ? '' : ' — not connected yet'}</option>
            ))}
          </Select>
        </Field>
        <Field label="Payment window (minutes)" hint="Unpaid QR orders are cancelled after this and the stock is released."><Input disabled={d} inputMode="numeric" value={f.window} onChange={(e) => set('window', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Instructions on the payment screen"><Input disabled={d} value={f.qrPaymentInstructions} onChange={(e) => set('qrPaymentInstructions', e.target.value)} /></Field></div>
        <div className="space-y-2 sm:col-span-2">
          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span className="font-semibold">{p.label}</span>
              <Badge className={p.configured ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}>{p.configured ? (p.id === 'simulated' ? 'Available (demo only)' : 'Connected') : 'Not connected'}</Badge>
            </div>
          ))}
          <Notice tone="info">
            <b>ABA PayWay</b> is a placeholder ready for your ABA API: add your merchant ID and API key to the server's <code>.env</code> and implement <code>server/src/services/providers/aba-payway.ts</code>. The payment screen, stock holding, order release after payment and expiry are already wired up.
          </Notice>
        </div>
      </Card>
    </div>
  );
}
