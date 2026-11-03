import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, cx, Field, Input, Notice, Skeleton, Textarea } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { dayLabel, money } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { useAddresses, useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { canRequestContact, haptic, requestTelegramContact } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { CouponInfo, DeliverySpeed, LatLng, OrderDetail, User, WalletItem } from '../../lib/types';
import { useCartQuote } from './Cart';
import { metresBetween } from '../../components/maps/shared';
import type { GeoAddress } from '../../lib/googleMaps';

const MapPicker = lazy(() => import('../../components/MapPicker'));

const KEY_STORAGE = 'sm-checkout-key';
/** One idempotency key per checkout attempt: retries / double taps can never create two orders. */
function checkoutKey() {
  try {
    let k = sessionStorage.getItem(KEY_STORAGE);
    if (!k) {
      k = crypto.randomUUID();
      sessionStorage.setItem(KEY_STORAGE, k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}

type Discount = { kind: 'reward'; id: number } | { kind: 'code'; code: string } | null;

export function Checkout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useT();
  const { user, setUser } = useSession();
  const lines = useCart((s) => s.lines);
  const clearCart = useCart((s) => s.clear);
  const shop = useShop();
  const addresses = useAddresses();

  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [addressId, setAddressId] = useState<number | null>(null);
  const [newAddress, setNewAddress] = useState({ line1: '', line2: '', city: '', instructions: '' });
  const [addingAddress, setAddingAddress] = useState(false);
  const [contactName, setContactName] = useState(`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim());
  const [contactPhone, setContactPhone] = useState(user?.phone ?? '');
  const [discount, setDiscount] = useState<Discount>(null);
  const [codeInput, setCodeInput] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Customer's map pin (distance pricing) and "today / tomorrow" choice. */
  const [pin, setPin] = useState<LatLng | null>(null);
  const [speed, setSpeed] = useState<DeliverySpeed>('same_day');
  const [filledFromMap, setFilledFromMap] = useState(false);
  const [movedToNew, setMovedToNew] = useState(false);
  // Set synchronously on success so clearing the cart doesn't trigger the empty-cart redirect.
  const placed = useRef(false);

  useEffect(() => {
    if (shop.data && !shop.data.deliveryEnabled) setFulfillment('pickup');
  }, [shop.data]);
  useEffect(() => {
    if (addresses.data && addressId == null) {
      const def = addresses.data.find((a) => a.isDefault) ?? addresses.data[0];
      if (def) setAddressId(def.id);
      else setAddingAddress(true);
    }
  }, [addresses.data, addressId]);
  // Picking a saved address brings back its pin (customers can still fine-tune it).
  useEffect(() => {
    if (addingAddress) return;
    const a = addresses.data?.find((x) => x.id === addressId);
    setPin(a && a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null);
  }, [addressId, addingAddress, addresses.data]);

  const discountParams = useMemo(
    () => (discount?.kind === 'reward' ? { customerRewardId: discount.id } : discount?.kind === 'code' ? { couponCode: discount.code } : {}),
    [discount],
  );
  const quoteQ = useCartQuote(fulfillment, discountParams, { location: pin, deliverySpeed: speed });
  const q = quoteQ.data?.quote;
  const wallet: WalletItem[] = quoteQ.data?.discounts.wallet ?? [];
  const publicCoupons: CouponInfo[] = quoteQ.data?.discounts.publicCoupons ?? [];

  const place = useMutation({
    mutationFn: () =>
      api<{ order: OrderDetail; replayed: boolean }>('/orders', {
        body: {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          fulfillmentType: fulfillment,
          ...discountParams,
          idempotencyKey: checkoutKey(),
          paymentMethod: 'cash',
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          addressId: fulfillment === 'delivery' && !addingAddress ? addressId : null,
          location: fulfillment === 'delivery' ? pin : null,
          deliverySpeed: speed,
          address:
            fulfillment === 'delivery' && addingAddress
              ? { label: 'Home', line1: newAddress.line1, line2: newAddress.line2 || null, city: newAddress.city, instructions: newAddress.instructions || null, save: true }
              : null,
          note: note.trim() || null,
        },
      }),
    onSuccess: ({ order }) => {
      placed.current = true;
      haptic('success');
      try {
        sessionStorage.removeItem(KEY_STORAGE);
      } catch {
        /* ignore */
      }
      clearCart();
      for (const k of ['orders', 'home', 'rewards', 'addresses', 'products']) qc.invalidateQueries({ queryKey: [k] });
      navigate(`/orders/${order.id}?placed=1`, { replace: true });
    },
    onError: (e) => {
      haptic('error');
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) quoteQ.refetch();
    },
  });

  if (lines.length === 0 && !placed.current) return <Navigate to="/cart" replace />;
  if (lines.length === 0) return null;

  const shareContact = async () => {
    const r = await requestTelegramContact();
    if (!r) return;
    try {
      const res = await api<{ user: User }>('/me/phone', { method: 'PUT', body: { contactResponse: r.response } });
      setUser(res.user);
      setContactPhone(res.user.phone ?? '');
      toast(t('co.phone_ok'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const s = shop.data;
  const byDistance = s?.deliveryPricing === 'distance';
  const showMap = byDistance || !!s?.mapsApiKey;

  const startNewAddress = () => {
    setAddingAddress(true);
    setMovedToNew(false);
    setFilledFromMap(false);
    setNewAddress({ line1: '', line2: '', city: '', instructions: '' });
  };
  // Moving the pin well away from the chosen saved address means a different place: start a new address.
  const onPinChange = (p: LatLng) => {
    setPin(p);
    const saved = addingAddress ? null : addresses.data?.find((a) => a.id === addressId);
    if (saved && saved.lat != null && saved.lng != null && metresBetween({ lat: saved.lat, lng: saved.lng }, p) > 200) {
      startNewAddress();
      setMovedToNew(true);
    }
  };
  // Google Maps: the street under the pin fills the new-address form (the customer adds house no. / floor).
  const onMapAddress = (a: GeoAddress) => {
    if (!addingAddress) return;
    setNewAddress((n) => ({ ...n, line1: a.line1 || n.line1, city: a.city || n.city }));
    setFilledFromMap(true);
  };
  const dq = fulfillment === 'delivery' ? q?.delivery : null;
  const addressReady = addingAddress ? newAddress.line1.trim().length >= 3 && newAddress.city.trim().length >= 2 : addressId != null;
  const deliveryReady = fulfillment === 'pickup' || (addressReady && (!byDistance || (pin != null && !dq?.tooFar)));
  const canPlace = !!q?.canPlace && deliveryReady && contactName.trim() && contactPhone.trim().length >= 5 && !(discount && q?.couponError);
  const deliveryCardText = !s?.deliveryEnabled
    ? t('co.unavailable_today')
    : q && fulfillment === 'delivery' && q.delivery?.freeByThreshold
      ? t('common.free')
      : byDistance
        ? dq?.sameDayFeeCents != null
          ? money(speed === 'next_day' && dq.nextDayFeeCents != null ? dq.nextDayFeeCents : dq.sameDayFeeCents)
          : t('co.from', { amount: money(Math.min(s.deliveryMinFeeCents, s.nextDayEnabled ? s.nextDayFeeCents : Infinity)) })
        : s
          ? money(s.deliveryFeeCents)
          : '';
  const labelOf = (l: string) => (['Home', 'Work', 'Other'].includes(l) ? t(`pf.label_${l}` as 'pf.label_Home') : l);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('co.title')}</h1>

      {/* 1. Delivery or pickup */}
      <section>
        <h2 className="mb-2 font-bold">{t('co.how')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            active={fulfillment === 'delivery'}
            disabled={!s?.deliveryEnabled}
            onClick={() => setFulfillment('delivery')}
            icon="🚚"
            title={t('co.delivery')}
            text={deliveryCardText}
          />
          <OptionCard active={fulfillment === 'pickup'} disabled={!s?.pickupEnabled} onClick={() => setFulfillment('pickup')} icon="🏪" title={t('co.pickup')} text={s?.pickupEnabled ? t('co.pickup_free') : t('co.unavailable')} />
        </div>
        {fulfillment === 'pickup' && s && (
          <Card className="mt-3 text-sm">
            {s.pickupAddress && <div className="font-semibold">📍 {s.pickupAddress}</div>}
            {s.pickupHours && <div className="text-muted">🕒 {s.pickupHours}</div>}
            <div className="mt-1 text-muted">{t('co.pickup_msg')}</div>
          </Card>
        )}
      </section>

      {/* 2. Address + map pin — only for delivery. Moving the pin fills in the address (Google Maps). */}
      {fulfillment === 'delivery' && (
        <section className="space-y-2">
          <h2 className="font-bold">{t('co.address')}</h2>
          {addresses.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <>
              {!addingAddress &&
                addresses.data?.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAddressId(a.id)}
                    className={cx('flex w-full items-start gap-3 rounded-2xl bg-surface p-3.5 text-left ring-2 transition', addressId === a.id ? 'ring-brand' : 'ring-line/60')}
                  >
                    <span className="text-xl">{a.label === 'Work' ? '🏢' : '🏠'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{labelOf(a.label)}</span>
                      <span className="block text-sm text-muted">{[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</span>
                    </span>
                    {addressId === a.id && <span className="text-brand">●</span>}
                  </button>
                ))}
              {!addingAddress && (
                <button className="w-full rounded-2xl border-2 border-dashed border-line p-3 text-sm font-semibold text-muted" onClick={startNewAddress}>
                  {t('co.add_address')}
                </button>
              )}

              {showMap && (
                <div className="pt-2">
                  <div className="mb-2 text-sm font-semibold">{t('co.pin_title')}</div>
                  <Suspense fallback={<Skeleton className="h-[260px] rounded-3xl" />}>
                    <MapPicker value={pin} onChange={onPinChange} store={s?.store} hint={t('co.pin_hint')} onAddress={onMapAddress} />
                  </Suspense>
                  {byDistance && (
                    <div className="mt-2 text-sm">
                      {!pin ? (
                        <p className="text-muted">{t('co.pin_needed')}</p>
                      ) : dq?.tooFar ? (
                        <Notice tone="error">{t('co.too_far', { max: dq.maxKm ?? '' })}</Notice>
                      ) : dq?.distanceKm != null ? (
                        <p className="font-semibold">{t('co.pin_distance', { km: dq.distanceKm })}</p>
                      ) : null}
                    </div>
                  )}
                </div>
              )}

              {addingAddress && (
                <Card className="space-y-3">
                  {movedToNew && <Notice tone="info">{t('co.new_from_map')}</Notice>}
                  <div className="font-bold">{t('co.new_address')}</div>
                  {filledFromMap && <p className="text-xs font-semibold text-brand">{t('co.address_filled')}</p>}
                  <Field label={t('co.street')}>
                    <Input value={newAddress.line1} onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })} placeholder={t('co.street_ph')} autoComplete="address-line1" />
                  </Field>
                  <Field label={t('co.apt')}>
                    <Input value={newAddress.line2} onChange={(e) => setNewAddress({ ...newAddress, line2: e.target.value })} autoComplete="address-line2" />
                  </Field>
                  <Field label={t('co.city')}>
                    <Input value={newAddress.city} onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })} autoComplete="address-level2" />
                  </Field>
                  <Field label={t('co.directions')}>
                    <Input value={newAddress.instructions} onChange={(e) => setNewAddress({ ...newAddress, instructions: e.target.value })} placeholder={t('co.directions_ph')} />
                  </Field>
                  <p className="text-xs text-muted">{t('co.saved_next')}</p>
                  {(addresses.data?.length ?? 0) > 0 && (
                    <button
                      className="text-sm font-semibold text-muted underline"
                      onClick={() => {
                        setAddingAddress(false);
                        setMovedToNew(false);
                      }}
                    >
                      {t('co.use_saved')}
                    </button>
                  )}
                </Card>
              )}
            </>
          )}
        </section>
      )}

      {/* 2c. Today or tomorrow */}
      {fulfillment === 'delivery' && s?.nextDayEnabled && !dq?.tooFar && (
        <section>
          <h2 className="mb-2 font-bold">{t('co.when')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <OptionCard
              active={speed === 'same_day'}
              onClick={() => setSpeed('same_day')}
              icon=""
              title={t('co.today')}
              text={
                dq?.freeByThreshold
                  ? t('common.free')
                  : dq?.sameDayFeeCents != null
                    ? money(dq.sameDayFeeCents)
                    : byDistance
                      ? t('co.fee_after_pin')
                      : money(s.deliveryFeeCents)
              }
              sub={byDistance ? t('co.today_text') : undefined}
            />
            <OptionCard
              active={speed === 'next_day'}
              onClick={() => setSpeed('next_day')}
              icon=""
              title={t('co.tomorrow')}
              text={dq?.freeByThreshold ? t('common.free') : money(dq?.nextDayFeeCents ?? s.nextDayFeeCents)}
              sub={t('co.tomorrow_text', { date: dayLabel(q?.nextDayDate) })}
            />
          </div>
          {dq?.freeByThreshold && <p className="mt-2 text-sm font-semibold text-brand">{t('co.free_threshold_both')}</p>}
        </section>
      )}

      {/* 3. Contact */}
      <section>
        <h2 className="mb-2 font-bold">{t('co.contact')}</h2>
        <Card className="space-y-3">
          <Field label={t('co.name')}>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label={t('co.phone')} hint={user?.phoneVerified && contactPhone === user.phone ? t('co.phone_verified') : t('co.phone_hint')}>
            <Input type="tel" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="tel" placeholder="+855 12 345 678" />
          </Field>
          {!contactPhone && canRequestContact() && (
            <Button variant="secondary" block onClick={shareContact}>
              {t('ob.share_phone')}
            </Button>
          )}
        </Card>
      </section>

      {/* 4. Rewards & coupons */}
      <section>
        <h2 className="mb-2 font-bold">{t('co.rewards')}</h2>
        <div className="space-y-2">
          {wallet.map((w) => (
            <DiscountOption
              key={w.id}
              active={discount?.kind === 'reward' && discount.id === w.id}
              onClick={() => setDiscount(discount?.kind === 'reward' && discount.id === w.id ? null : { kind: 'reward', id: w.id })}
              emoji={w.emoji}
              title={w.title}
              text={w.coupon.benefit + (w.coupon.minSubtotalCents ? t('co.min', { amount: money(w.coupon.minSubtotalCents) }) : '')}
              tag={t('co.your_reward')}
              appliedLabel={t('co.applied')}
            />
          ))}
          {publicCoupons.map((c) => (
            <DiscountOption
              key={c.id}
              active={discount?.kind === 'code' && discount.code === c.code}
              onClick={() => setDiscount(discount?.kind === 'code' && discount.code === c.code ? null : { kind: 'code', code: c.code! })}
              emoji="🏷️"
              title={c.title}
              text={t('co.code', { code: c.code ?? '' }) + (c.minSubtotalCents ? t('co.min', { amount: money(c.minSubtotalCents) }) : '')}
              tag={t('co.for_everyone')}
              appliedLabel={t('co.applied')}
            />
          ))}
          <div className="flex gap-2">
            <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder={t('co.have_code')} className="uppercase" />
            <Button variant="secondary" disabled={!codeInput.trim()} onClick={() => setDiscount({ kind: 'code', code: codeInput.trim() })}>
              {t('co.apply')}
            </Button>
          </div>
          {discount && q?.couponError && <Notice tone="warn">{q.couponError}</Notice>}
          {discount && q?.discount && <Notice tone="success">{t('co.applied_msg', { label: q.discount.label })}</Notice>}
          <p className="text-xs text-muted">{t('co.one_per_order')}</p>
        </div>
      </section>

      {/* 5. Payment — cash on delivery / at pickup */}
      <section>
        <h2 className="mb-2 font-bold">{t('co.payment')}</h2>
        <div className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 ring-2 ring-brand">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-2xl">💵</span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{fulfillment === 'delivery' ? t('co.cash_delivery') : t('co.cash_pickup')}</span>
            <span className="block text-sm text-muted">{fulfillment === 'delivery' ? t('co.cash_delivery_text') : t('co.cash_pickup_text')}</span>
          </span>
        </div>
      </section>

      <section>
        <Field label={t('co.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('co.note_ph')} maxLength={500} />
        </Field>
      </section>

      {/* 6. Summary */}
      <section>
        <h2 className="mb-2 font-bold">{t('co.summary')}</h2>
        <Card className="space-y-2">
          {!q ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              {q.lines
                .filter((l) => l.isGift)
                .map((l) => (
                  <div key="gift" className="flex justify-between text-sm">
                    <span>{t('co.gift_line', { name: l.name })}</span>
                    <span className="font-semibold text-brand">{t('common.free_caps')}</span>
                  </div>
                ))}
              <Row label={t('co.items', { n: lines.reduce((n, l) => n + l.quantity, 0) })} value={money(q.subtotalCents)} />
              {fulfillment === 'delivery' && (
                <Row
                  label={speed === 'next_day' && s?.nextDayEnabled ? t('co.delivery_fee_tomorrow') : t('co.delivery_fee')}
                  value={
                    q.delivery?.needsLocation ? (
                      <span className="text-muted">{t('co.fee_after_pin')}</span>
                    ) : q.baseDeliveryFeeCents === 0 ? (
                      t('common.free_caps')
                    ) : q.deliveryDiscountCents > 0 ? (
                      <span>
                        <s className="text-muted">{money(q.baseDeliveryFeeCents)}</s> {t('common.free_caps')}
                      </span>
                    ) : (
                      money(q.baseDeliveryFeeCents)
                    )
                  }
                />
              )}
              {q.itemDiscountCents > 0 && <Row label={q.discount?.label ?? t('co.discount')} value={`−${money(q.itemDiscountCents)}`} tone="text-brand" />}
              {fulfillment === 'delivery' && q.freeDeliveryRemainingCents != null && q.freeDeliveryRemainingCents > 0 && q.deliveryDiscountCents === 0 && (
                <p className="text-xs text-muted">{t('co.add_for_free', { amount: money(q.freeDeliveryRemainingCents) })}</p>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="font-bold">{t('co.total')}</span>
                <span className="text-2xl font-black">{money(q.totalCents)}</span>
              </div>
              {q.discountCents > 0 && <p className="text-sm font-semibold text-brand">{t('co.you_save', { amount: money(q.discountCents) })}</p>}
              {q.pointsEstimate > 0 && (
                <p className="text-sm font-semibold text-amber-600">{t(fulfillment === 'delivery' ? 'co.points_delivered' : 'co.points_collected', { n: q.pointsEstimate })}</p>
              )}
            </>
          )}
        </Card>
        {q && q.issues.length > 0 && (
          <Notice tone="error" className="mt-3">
            {q.issues.map((i) => (
              <div key={i}>{i}</div>
            ))}
            <Link to="/cart" className="mt-1 inline-block font-bold underline">
              {t('co.review_basket')}
            </Link>
          </Notice>
        )}
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3">
          <Button
            block
            size="lg"
            disabled={!canPlace}
            loading={place.isPending}
            onClick={() => {
              setError(null);
              place.mutate();
            }}
          >
            {t('co.place', { amount: q ? money(q.totalCents) : '' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className={cx('flex justify-between gap-3', tone)}>
      <span className={tone ? '' : 'text-muted'}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function OptionCard({
  active,
  disabled,
  onClick,
  icon,
  title,
  text,
  sub,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: string;
  title: string;
  text: string;
  sub?: string;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => {
        haptic('select');
        onClick();
      }}
      className={cx('flex flex-col items-start rounded-3xl bg-surface p-4 text-left ring-2 transition disabled:opacity-40', active ? 'ring-brand' : 'ring-line/60')}
    >
      {icon && <span className="mb-2 text-3xl">{icon}</span>}
      <span className="font-bold">{title}</span>
      <span className="text-sm font-semibold text-muted">{text}</span>
      {sub && <span className="mt-0.5 text-xs text-muted">{sub}</span>}
    </button>
  );
}

function DiscountOption({ active, onClick, emoji, title, text, tag, appliedLabel }: { active: boolean; onClick: () => void; emoji: string; title: string; text: string; tag: string; appliedLabel: string }) {
  return (
    <button
      onClick={() => {
        haptic('select');
        onClick();
      }}
      className={cx('flex w-full items-center gap-3 rounded-2xl p-3.5 text-left ring-2 transition', active ? 'bg-amber-50 ring-amber-400 dark:bg-amber-500/10' : 'bg-surface ring-line/60')}
    >
      <span className="text-2xl">{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <span className="shrink-0 text-xs font-bold text-muted">{active ? appliedLabel : tag}</span>
    </button>
  );
}
