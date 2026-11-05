/**
 * Checkout, in order: review the basket → delivery or pickup → delivery details (address, map pin,
 * today / tomorrow) → contact → rewards → payment → summary (Subtotal / Delivery fee / Total) → place.
 *
 * Delivery fee rules (the server is the source of truth, see services/pricing.ts):
 *  - no location yet → "Enter your delivery address to calculate the fee" (never $0, never "free")
 *  - while recalculating → loading, and "Place order" is blocked (no stale fee)
 *  - unsupported location / failed calculation → message next to the address, retry, no fee
 *  - free delivery only when the location is validated AND the basket meets the shop's rule
 * Everything entered is kept (session draft) when going back to the basket or retrying.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Building2, CalendarDays, Check, ChevronDown, Clock, Gift, House, MapPin, Plus, Star, Store, Ticket, Truck, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { metresBetween } from '../../components/maps/shared';
import { Button, cx, Field, Input, Notice, Skeleton, Spinner, Textarea } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { useCheckoutDraft, EMPTY_ADDRESS, type Discount } from '../../lib/checkoutDraft';
import { dayLabel, money } from '../../lib/format';
import type { GeoAddress } from '../../lib/googleMaps';
import { useT } from '../../lib/i18n';
import { useAddresses, useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { canRequestContact, haptic, requestTelegramContact } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { Address, CouponInfo, LatLng, OrderDetail, User, WalletItem } from '../../lib/types';
import { useCartQuote } from './Cart';

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

type FieldKey = 'street' | 'city' | 'name' | 'phone' | 'location' | 'summary';
type FeeState = 'pickup' | 'loading' | 'error' | 'needs_address' | 'unsupported' | 'unavailable' | 'ok';

const pinOf = (a: Address | undefined): LatLng | null => (a && a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null);

export function Checkout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useT();
  const { user, setUser } = useSession();
  const lines = useCart((s) => s.lines);
  const clearCart = useCart((s) => s.clear);
  const shop = useShop();
  const addresses = useAddresses();
  const d = useCheckoutDraft();
  const set = d.set;
  const [codeInput, setCodeInput] = useState('');
  const [offersOpen, setOffersOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  // Set synchronously on success so clearing the cart doesn't trigger the empty-cart redirect.
  const placed = useRef(false);
  const deliveryRef = useRef<HTMLElement>(null);
  const contactRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // A draft belongs to one customer; prefill contact details from the profile.
  useEffect(() => {
    if (user) d.ensureOwner(user.id, `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(), user.phone ?? '');
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shop.data && !shop.data.deliveryEnabled && d.fulfillment === 'delivery') set({ fulfillment: 'pickup' });
  }, [shop.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // First visit: pick the default saved address (with its pin), or start a new one.
  useEffect(() => {
    if (!addresses.data) return;
    const chosen = d.addressId != null ? addresses.data.find((a) => a.id === d.addressId) : undefined;
    if (d.addingAddress || chosen) return;
    const def = addresses.data.find((a) => a.isDefault) ?? addresses.data[0];
    if (def) set({ addressId: def.id, pin: pinOf(def) });
    else set({ addressId: null, addingAddress: true });
  }, [addresses.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = shop.data;
  const delivery = d.fulfillment === 'delivery';
  const byDistance = s?.deliveryPricing === 'distance';
  const showMap = byDistance || !!s?.mapsApiKey;
  const streetOk = d.newAddress.line1.trim().length >= 3;
  const cityOk = d.newAddress.city.trim().length >= 2;
  const addressReady = delivery && (d.addingAddress ? streetOk && cityOk : d.addressId != null);

  const discountParams = useMemo(
    () => (d.discount?.kind === 'reward' ? { customerRewardId: d.discount.id } : d.discount?.kind === 'code' ? { couponCode: d.discount.code } : {}),
    [d.discount],
  );
  const quoteQ = useCartQuote(d.fulfillment, discountParams, { location: delivery ? d.pin : null, deliverySpeed: d.speed, addressReady });
  const q = quoteQ.data?.quote;
  const wallet: WalletItem[] = quoteQ.data?.discounts.wallet ?? [];
  const publicCoupons: CouponInfo[] = quoteQ.data?.discounts.publicCoupons ?? [];
  // Anything shown while a new calculation runs is stale: show loading and block the order.
  const recalculating = quoteQ.isFetching || quoteQ.isPlaceholderData;
  const quoteFailed = quoteQ.isError && !quoteQ.isFetching;
  const dq = delivery ? (q?.delivery ?? null) : null;
  const feeState: FeeState = !delivery
    ? 'pickup'
    : quoteFailed
      ? 'error'
      : !q || recalculating
        ? 'loading'
        : (dq?.status ?? 'needs_address');

  const clientErrors: Partial<Record<FieldKey, string>> = {
    street: delivery && d.addingAddress && !streetOk ? t('co.err_street') : undefined,
    city: delivery && d.addingAddress && !cityOk ? t('co.err_city') : undefined,
    name: !d.contactName.trim() ? t('co.err_name') : undefined,
    phone: d.contactPhone.trim().length < 5 ? t('co.err_phone') : undefined,
    location: delivery && byDistance && !d.pin ? t('co.err_pin') : undefined,
  };
  const errorFor = (k: FieldKey) => serverErrors[k] ?? (attempted ? clientErrors[k] : undefined) ?? null;
  const clearServerError = (...keys: FieldKey[]) =>
    setServerErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });

  const effectiveFeeCents = q && q.baseDeliveryFeeCents != null ? q.baseDeliveryFeeCents - q.deliveryDiscountCents : null;
  const place = useMutation({
    mutationFn: () =>
      api<{ order: OrderDetail; replayed: boolean }>('/orders', {
        body: {
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          fulfillmentType: d.fulfillment,
          ...discountParams,
          idempotencyKey: checkoutKey(),
          paymentMethod: 'cash',
          contactName: d.contactName.trim(),
          contactPhone: d.contactPhone.trim(),
          addressId: delivery && !d.addingAddress ? d.addressId : null,
          location: delivery ? d.pin : null,
          deliverySpeed: d.speed,
          address:
            delivery && d.addingAddress
              ? {
                  label: 'Home',
                  line1: d.newAddress.line1,
                  line2: d.newAddress.line2 || null,
                  city: d.newAddress.city,
                  instructions: d.newAddress.instructions || null,
                  save: true,
                }
              : null,
          note: d.note.trim() || null,
          // What the customer is looking at — the server re-checks it before creating the order.
          expectedDeliveryFeeCents: delivery ? effectiveFeeCents : undefined,
          expectedTotalCents: q?.totalCents,
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
      d.reset();
      for (const k of ['orders', 'home', 'rewards', 'addresses', 'products']) qc.invalidateQueries({ queryKey: [k] });
      navigate(`/orders/${order.id}?placed=1`, { replace: true });
    },
    onError: (e) => {
      haptic('error');
      const errs: Partial<Record<FieldKey, string>> = {};
      let target: RefObject<HTMLElement | null> = summaryRef;
      if (e instanceof ApiError && e.code === 'validation_error' && Array.isArray(e.details)) {
        for (const issue of e.details as { path: string }[]) {
          if (issue.path === 'address.line1') errs.street ??= t('co.err_street');
          else if (issue.path === 'address.city') errs.city ??= t('co.err_city');
          else if (issue.path === 'contactName') errs.name ??= t('co.err_name');
          else if (issue.path === 'contactPhone') errs.phone ??= t('co.err_phone');
        }
        target = errs.street || errs.city ? deliveryRef : contactRef;
        if (!Object.keys(errs).length) errs.summary = e.message;
      } else if (e instanceof ApiError && e.code === 'invalid_phone') {
        errs.phone = e.message;
        target = contactRef;
      } else if (e instanceof ApiError && (e.code === 'address_required' || e.code === 'address_not_found')) {
        errs.street = e.message;
        target = deliveryRef;
      } else if (e instanceof ApiError && e.code.startsWith('delivery_')) {
        errs.location = e.message;
        target = deliveryRef;
      } else {
        errs.summary = errorMessage(e);
      }
      setServerErrors(errs);
      setAttempted(true);
      target.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Fee/total changed, stock moved, location rejected… → recalculate so the summary is current.
      if (e instanceof ApiError && e.status === 409) void quoteQ.refetch();
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
      set({ contactPhone: res.user.phone ?? '' });
      clearServerError('phone');
      toast(t('co.phone_ok'), 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const chooseSaved = (a: Address) => {
    set({ addressId: a.id, addingAddress: false, pin: pinOf(a), movedToNew: false });
    clearServerError('street', 'city', 'location');
  };
  const startNewAddress = (keepPin = true) => {
    set({ addingAddress: true, movedToNew: false, filledFromMap: false, newAddress: EMPTY_ADDRESS, ...(keepPin ? {} : { pin: null }) });
    clearServerError('street', 'city');
  };
  // Moving the pin well away from the chosen saved address means a different place: start a new address.
  const onPinChange = (p: LatLng) => {
    clearServerError('location');
    const saved = d.addingAddress ? undefined : addresses.data?.find((a) => a.id === d.addressId);
    const savedPin = pinOf(saved);
    if (savedPin && metresBetween(savedPin, p) > 200) {
      set({ pin: p, addingAddress: true, movedToNew: true, filledFromMap: false, newAddress: EMPTY_ADDRESS });
    } else set({ pin: p });
  };
  // Google Maps: the street under the pin fills the new-address form (the customer adds house no. / floor).
  const onMapAddress = (a: GeoAddress) => {
    if (!useCheckoutDraft.getState().addingAddress) return;
    const n = useCheckoutDraft.getState().newAddress;
    set({ newAddress: { ...n, line1: a.line1 || n.line1, city: a.city || n.city }, filledFromMap: true });
    clearServerError('street', 'city');
  };
  const editAddress = (patch: Partial<typeof d.newAddress>, field: FieldKey) => {
    set({ newAddress: { ...d.newAddress, ...patch } });
    clearServerError(field);
  };
  const setDiscount = (x: Discount) => set({ discount: x });

  const labelOf = (l: string) => (['Home', 'Work', 'Other'].includes(l) ? t(`pf.label_${l}` as 'pf.label_Home') : l);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const formOk = !clientErrors.street && !clientErrors.city && !clientErrors.name && !clientErrors.phone;
  const quoteReady = !!q && !recalculating && !quoteFailed;
  const deliveryOk = !delivery || feeState === 'ok';
  const canPlace = quoteReady && deliveryOk && q!.canPlace && !(d.discount && q!.couponError);

  const onPrimary = () => {
    setAttempted(true);
    if (feeState === 'error') return void quoteQ.refetch();
    if (delivery && feeState !== 'ok') return deliveryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!formOk) {
      const ref = clientErrors.street || clientErrors.city ? deliveryRef : contactRef;
      return ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (!canPlace) return summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setServerErrors({});
    place.mutate();
  };
  const primaryLabel =
    feeState === 'loading'
      ? t('co.place_calculating')
      : feeState === 'error'
        ? t('co.place_retry')
        : feeState === 'needs_address'
          ? t('co.place_enter_address')
          : feeState === 'unsupported' || feeState === 'unavailable'
            ? t('co.place_fix_address')
            : t('co.place', { amount: q ? money(q.totalCents) : '' });

  /** The delivery-fee value in the summary — never $0 or "Free delivery" unless validated. */
  const feeValue = (): ReactNode => {
    switch (feeState) {
      case 'loading':
        return (
          <span className="inline-flex items-center gap-1.5 font-normal text-muted">
            <Spinner className="h-3.5 w-3.5" /> {t('co.fee_calculating')}
          </span>
        );
      case 'error':
        return <span className="font-semibold text-rose-600">{t('co.fee_failed_short')}</span>;
      case 'needs_address':
        return <span className="text-right text-sm font-normal text-muted">{t('co.fee_enter_address')}</span>;
      case 'unsupported':
        return <span className="text-right text-sm font-semibold text-rose-600">{t('co.fee_unsupported')}</span>;
      case 'unavailable':
        return <span className="text-right text-sm font-semibold text-rose-600">{t('co.fee_unavailable')}</span>;
      case 'ok':
        if (dq?.freeDelivery || (q && q.deliveryDiscountCents > 0)) {
          return (
            <span>
              <s className="mr-1 font-normal text-muted">{money(dq?.standardFeeCents ?? q?.baseDeliveryFeeCents ?? 0)}</s>
              <span className="text-brand">{t('co.free_delivery')}</span>
            </span>
          );
        }
        return money(q!.baseDeliveryFeeCents!);
      default:
        return null;
    }
  };
  const totalKnown = quoteReady && !q!.totalPending && deliveryOk;

  return (
    <div className="space-y-3">
      <h1 className="pb-1 text-[22px] font-bold">{t('co.title')}</h1>

      {/* 1. Review the basket */}
      <section className={BLOCK}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className={H2}>{t('co.your_items', { n: count })}</h2>
          <Link to="/cart" className="text-sm font-semibold text-brand">
            {t('co.edit_basket')}
          </Link>
        </div>
        <div className="space-y-1.5 text-sm">
          {lines.slice(0, 3).map((l) => (
            <div key={l.productId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="text-muted">{l.quantity}×</span> {l.name}
              </span>
              <span className="shrink-0">{money(l.priceCents * l.quantity)}</span>
            </div>
          ))}
          {lines.length > 3 && <div className="text-muted">{t('co.and_more', { n: lines.length - 3 })}</div>}
        </div>
      </section>

      {/* 2. Delivery or pickup */}
      <section className={BLOCK}>
        <h2 className={cx(H2, 'mb-3')}>{t('co.how')}</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <OptionCard
            active={delivery}
            disabled={!s?.deliveryEnabled}
            onClick={() => set({ fulfillment: 'delivery' })}
            icon={Truck}
            title={t('co.delivery')}
            text={!s?.deliveryEnabled ? t('co.unavailable_today') : t('co.fee_from_address')}
          />
          <OptionCard
            active={!delivery}
            disabled={!s?.pickupEnabled}
            onClick={() => set({ fulfillment: 'pickup' })}
            icon={Store}
            title={t('co.pickup')}
            text={s?.pickupEnabled ? t('co.pickup_free') : t('co.unavailable')}
          />
        </div>
        {!delivery && s && (
          <div className="mt-3 space-y-1.5 text-sm">
            {s.pickupAddress && (
              <div className="flex items-start gap-2 font-semibold">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                {s.pickupAddress}
              </div>
            )}
            {s.pickupHours && (
              <div className="flex items-start gap-2 text-muted">
                <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                {s.pickupHours}
              </div>
            )}
            <div className="text-muted">{t('co.pickup_msg')}</div>
          </div>
        )}
      </section>

      {/* 3. Delivery details: saved address / map pin / new address — messages next to each field */}
      {delivery && (
        <section ref={deliveryRef} className={cx(BLOCK, 'scroll-mt-4 space-y-2.5')}>
          <h2 className={H2}>{t('co.address')}</h2>
          {addresses.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <>
              {!d.addingAddress &&
                addresses.data?.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => chooseSaved(a)}
                    className={cx('flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition', d.addressId === a.id ? 'bg-brand/5 ring-brand' : 'ring-line')}
                  >
                    {a.label === 'Work' ? <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-muted" /> : <House className="mt-0.5 h-5 w-5 shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{labelOf(a.label)}</span>
                      <span className="block text-sm text-muted">{[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</span>
                    </span>
                    <Radio on={d.addressId === a.id} />
                  </button>
                ))}
              {!d.addingAddress && (
                <button className="flex w-full items-center gap-2 rounded-xl px-1 py-2 text-sm font-semibold text-brand" onClick={() => startNewAddress()}>
                  <Plus className="h-4 w-4" />
                  {t('co.add_address')}
                </button>
              )}

              {showMap && (
                <div className="pt-2">
                  <div className="mb-2 text-sm font-semibold">{t('co.pin_title')}</div>
                  <Suspense fallback={<Skeleton className="h-[260px] rounded-xl" />}>
                    <MapPicker value={d.pin} onChange={onPinChange} store={s?.store} hint={t('co.pin_hint')} onAddress={d.addingAddress ? onMapAddress : undefined} />
                  </Suspense>
                </div>
              )}

              {/* Delivery messages, right under the map / address. */}
              <DeliveryMessage
                state={feeState}
                distanceKm={dq?.distanceKm ?? null}
                maxKm={dq?.maxKm ?? null}
                error={serverErrors.location ?? (attempted ? clientErrors.location : undefined)}
                needsPin={byDistance}
                onRetry={() => void quoteQ.refetch()}
                onPickup={s?.pickupEnabled ? () => set({ fulfillment: 'pickup' }) : undefined}
              />

              {d.addingAddress && (
                <div className="space-y-3 border-t border-line pt-3">
                  {d.movedToNew && <Notice tone="info">{t('co.new_from_map')}</Notice>}
                  <div className="font-bold">{t('co.new_address')}</div>
                  {d.filledFromMap && <p className="text-xs font-semibold text-brand">{t('co.address_filled')}</p>}
                  <Field label={t('co.street')} error={errorFor('street')}>
                    <Input
                      value={d.newAddress.line1}
                      onChange={(e) => editAddress({ line1: e.target.value }, 'street')}
                      placeholder={t('co.street_ph')}
                      autoComplete="address-line1"
                      aria-invalid={!!errorFor('street')}
                      className={cx(errorFor('street') && 'border-rose-400')}
                    />
                  </Field>
                  <Field label={t('co.apt')}>
                    <Input value={d.newAddress.line2} onChange={(e) => editAddress({ line2: e.target.value }, 'street')} autoComplete="address-line2" />
                  </Field>
                  <Field label={t('co.city')} error={errorFor('city')}>
                    <Input
                      value={d.newAddress.city}
                      onChange={(e) => editAddress({ city: e.target.value }, 'city')}
                      autoComplete="address-level2"
                      aria-invalid={!!errorFor('city')}
                      className={cx(errorFor('city') && 'border-rose-400')}
                    />
                  </Field>
                  <Field label={t('co.directions')}>
                    <Input value={d.newAddress.instructions} onChange={(e) => editAddress({ instructions: e.target.value }, 'street')} placeholder={t('co.directions_ph')} />
                  </Field>
                  <p className="text-xs text-muted">{t('co.saved_next')}</p>
                  {(addresses.data?.length ?? 0) > 0 && (
                    <button
                      className="text-sm font-semibold text-muted underline"
                      onClick={() => {
                        const def = addresses.data!.find((a) => a.id === d.addressId) ?? addresses.data![0];
                        chooseSaved(def);
                      }}
                    >
                      {t('co.use_saved')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 3b. Today or tomorrow */}
      {delivery && s?.nextDayEnabled && feeState !== 'unsupported' && (
        <section className={BLOCK}>
          <h2 className={cx(H2, 'mb-3')}>{t('co.when')}</h2>
          <div className="grid grid-cols-2 gap-2.5">
            <OptionCard
              active={d.speed === 'same_day'}
              onClick={() => set({ speed: 'same_day' })}
              icon={Clock}
              title={t('co.today')}
              text={speedPrice(feeState, dq?.freeDelivery, dq?.sameDayFeeCents, t)}
              sub={byDistance ? t('co.today_text') : undefined}
            />
            <OptionCard
              active={d.speed === 'next_day'}
              onClick={() => set({ speed: 'next_day' })}
              icon={CalendarDays}
              title={t('co.tomorrow')}
              text={speedPrice(feeState, dq?.freeDelivery, dq?.nextDayFeeCents ?? (feeState === 'ok' ? null : undefined), t)}
              sub={t('co.tomorrow_text', { date: dayLabel(q?.nextDayDate) })}
            />
          </div>
        </section>
      )}

      {/* 4. Contact */}
      <section ref={contactRef} className={cx(BLOCK, 'scroll-mt-4')}>
        <h2 className={cx(H2, 'mb-3')}>{t('co.contact')}</h2>
        <div className="space-y-3">
          <Field label={t('co.name')} error={errorFor('name')}>
            <Input
              value={d.contactName}
              onChange={(e) => {
                set({ contactName: e.target.value });
                clearServerError('name');
              }}
              autoComplete="name"
              aria-invalid={!!errorFor('name')}
              className={cx(errorFor('name') && 'border-rose-400')}
            />
          </Field>
          <Field
            label={t('co.phone')}
            error={errorFor('phone')}
            hint={user?.phoneVerified && d.contactPhone === user.phone ? t('co.phone_verified') : t('co.phone_hint')}
          >
            <Input
              type="tel"
              inputMode="tel"
              value={d.contactPhone}
              onChange={(e) => {
                set({ contactPhone: e.target.value });
                clearServerError('phone');
              }}
              autoComplete="tel"
              placeholder="+855 12 345 678"
              aria-invalid={!!errorFor('phone')}
              className={cx(errorFor('phone') && 'border-rose-400')}
            />
          </Field>
          {!d.contactPhone && canRequestContact() && (
            <Button variant="secondary" block onClick={shareContact}>
              {t('ob.share_phone')}
            </Button>
          )}
        </div>
      </section>

      {/* 5. Rewards & coupons */}
      <section className={BLOCK}>
        <button className="flex w-full items-center gap-3 text-left" onClick={() => setOffersOpen((v) => !v)} aria-expanded={offersOpen || !!d.discount}>
          <Ticket className="h-5 w-5 shrink-0 text-muted" />
          <span className={cx(H2, 'flex-1')}>{t('co.rewards')}</span>
          <span className={cx('text-sm', d.discount && q?.discount ? 'font-semibold text-brand' : 'text-muted')}>
            {d.discount && q?.discount ? q.discount.label : wallet.length + publicCoupons.length > 0 ? t('co.offers_available', { n: wallet.length + publicCoupons.length }) : ''}
          </span>
          <ChevronDown className={cx('h-5 w-5 shrink-0 text-muted transition', (offersOpen || !!d.discount) && 'rotate-180')} />
        </button>
        {(offersOpen || !!d.discount) && (
        <div className="mt-3 space-y-2">
          {wallet.map((w) => (
            <DiscountOption
              key={w.id}
              active={d.discount?.kind === 'reward' && d.discount.id === w.id}
              onClick={() => setDiscount(d.discount?.kind === 'reward' && d.discount.id === w.id ? null : { kind: 'reward', id: w.id })}
              icon={Gift}
              title={w.title}
              text={w.coupon.benefit + (w.coupon.minSubtotalCents ? t('co.min', { amount: money(w.coupon.minSubtotalCents) }) : '')}
              tag={t('co.your_reward')}
              appliedLabel={t('co.applied')}
            />
          ))}
          {publicCoupons.map((c) => (
            <DiscountOption
              key={c.id}
              active={d.discount?.kind === 'code' && d.discount.code === c.code}
              onClick={() => setDiscount(d.discount?.kind === 'code' && d.discount.code === c.code ? null : { kind: 'code', code: c.code! })}
              icon={Ticket}
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
          {d.discount && q?.couponError && <Notice tone="warn">{q.couponError}</Notice>}
          <p className="text-xs text-muted">{t('co.one_per_order')}</p>
        </div>
        )}
      </section>

      {/* 6. Payment — cash on delivery / at pickup */}
      <section className={BLOCK}>
        <h2 className={cx(H2, 'mb-3')}>{t('co.payment')}</h2>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
            <Banknote className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{delivery ? t('co.cash_delivery') : t('co.cash_pickup')}</span>
            <span className="block text-sm text-muted">{delivery ? t('co.cash_delivery_text') : t('co.cash_pickup_text')}</span>
          </span>
          <Check className="h-5 w-5 shrink-0 text-brand" />
        </div>
      </section>

      <section className={BLOCK}>
        <Field label={t('co.note')}>
          <Textarea value={d.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('co.note_ph')} maxLength={500} />
        </Field>
      </section>

      {/* 7. Final total: Subtotal / Delivery fee / Total */}
      <section ref={summaryRef} className={cx(BLOCK, 'scroll-mt-4')}>
        <h2 className={cx(H2, 'mb-3')}>{t('co.summary')}</h2>
        <div className="space-y-2">
          {!q ? (
            quoteFailed ? (
              <RetryNotice text={t('co.fee_failed')} onRetry={() => void quoteQ.refetch()} retry={t('common.try_again')} />
            ) : (
              <Skeleton className="h-24" />
            )
          ) : (
            <>
              <Row label={t('co.subtotal')} value={money(q.subtotalCents)} />
              {q.lines
                .filter((l) => l.isGift)
                .map((l) => (
                  <Row key="gift" label={t('co.gift_line', { name: l.name })} value={<span className="text-brand">{t('common.free_caps')}</span>} />
                ))}
              {q.itemDiscountCents > 0 && <Row label={q.discount?.label ?? t('co.discount')} value={`−${money(q.itemDiscountCents)}`} tone="text-brand" />}
              {delivery && (
                <Row label={d.speed === 'next_day' && s?.nextDayEnabled ? t('co.delivery_fee_tomorrow') : t('co.delivery_fee')} value={feeValue()} />
              )}
              {delivery && <FreeDeliveryHint feeState={feeState} info={dq} t={t} />}
              <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                <span className="font-bold">{totalKnown || !delivery ? t('co.total') : t('co.total_pending')}</span>
                <span className="text-xl font-bold">
                  {recalculating ? <Spinner className="h-5 w-5 text-muted" /> : totalKnown ? money(q.totalCents) : '—'}
                </span>
              </div>
              {totalKnown && q.discountCents > 0 && <p className="text-sm font-semibold text-brand">{t('co.you_save', { amount: money(q.discountCents) })}</p>}
              {q.pointsEstimate > 0 && (
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {t(delivery ? 'co.points_delivered' : 'co.points_collected', { n: q.pointsEstimate })}
                </p>
              )}
            </>
          )}
        </div>
        {quoteFailed && q && <RetryNotice text={t('co.fee_failed')} onRetry={() => void quoteQ.refetch()} retry={t('common.try_again')} className="mt-3" />}
        {q && !recalculating && q.issues.filter((i) => i !== dq?.message).length > 0 && (
          <Notice tone="error" className="mt-3">
            {q.issues
              .filter((i) => i !== dq?.message)
              .map((i) => (
                <div key={i}>{i}</div>
              ))}
            <Link to="/cart" className="mt-1 inline-block font-bold underline">
              {t('co.review_basket')}
            </Link>
          </Notice>
        )}
        {serverErrors.summary && (
          <Notice tone="error" className="mt-3">
            {serverErrors.summary}
          </Notice>
        )}
      </section>

      {/* One primary action, never active with a pending or stale fee. */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
        <div className="mx-auto max-w-xl px-4 py-3">
          <Button block size="lg" disabled={feeState === 'loading' || place.isPending} loading={place.isPending} onClick={onPrimary} variant={canPlace || feeState === 'error' ? 'primary' : 'secondary'}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function speedPrice(state: FeeState, free: boolean | undefined, cents: number | null | undefined, t: ReturnType<typeof useT>['t']) {
  if (state !== 'ok') return state === 'loading' ? t('co.fee_calculating') : t('co.fee_enter_address_short');
  if (cents == null) return t('co.fee_unavailable');
  return free ? t('co.free_delivery') : money(cents);
}

/** How the basket stands against the shop's actual free-delivery rule. */
function FreeDeliveryHint({ feeState, info, t }: { feeState: FeeState; info: { freeRule: { remainingCents: number; met: boolean; minCents: number } | null; freeDelivery: boolean } | null; t: ReturnType<typeof useT>['t'] }) {
  const rule = info?.freeRule;
  if (!rule || feeState === 'loading' || feeState === 'error') return null;
  if (!rule.met) return <p className="text-xs text-muted">{t('co.free_more', { amount: money(rule.remainingCents) })}</p>;
  if (feeState === 'ok' && info?.freeDelivery) return <p className="text-xs font-semibold text-brand">{t('co.free_qualifies')}</p>;
  return null; // qualifies by amount, but the address isn't validated yet — say nothing about "free"
}

function DeliveryMessage({
  state,
  distanceKm,
  maxKm,
  error,
  needsPin,
  onRetry,
  onPickup,
}: {
  state: FeeState;
  distanceKm: number | null;
  maxKm: number | null;
  error?: string;
  needsPin: boolean;
  onRetry: () => void;
  onPickup?: () => void;
}) {
  const { t } = useT();
  if (error && state !== 'ok' && state !== 'loading') {
    return (
      <Notice tone="error">
        {error}
        {state === 'error' && <RetryButton onRetry={onRetry} label={t('common.try_again')} />}
      </Notice>
    );
  }
  switch (state) {
    case 'loading':
      return (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Spinner className="h-3.5 w-3.5" /> {t('co.fee_calculating')}
        </p>
      );
    case 'error':
      return <RetryNotice text={t('co.fee_failed')} onRetry={onRetry} retry={t('common.try_again')} />;
    case 'needs_address':
      return <p className="text-sm text-muted">{needsPin ? t('co.pin_needed') : t('co.fee_enter_address')}</p>;
    case 'unsupported':
      return (
        <Notice tone="error">
          {t('co.too_far', { max: maxKm ?? '' })}
          {distanceKm != null && <span className="block text-xs opacity-80">{t('co.pin_distance', { km: distanceKm })}</span>}
          {onPickup && (
            <button className="mt-1 block font-bold underline" onClick={onPickup}>
              {t('co.choose_pickup')}
            </button>
          )}
        </Notice>
      );
    case 'unavailable':
      return <Notice tone="error">{t('co.delivery_unavailable')}</Notice>;
    case 'ok':
      return distanceKm != null ? <p className="text-sm font-semibold">{t('co.pin_distance', { km: distanceKm })}</p> : null;
    default:
      return null;
  }
}

function RetryButton({ onRetry, label }: { onRetry: () => void; label: string }) {
  return (
    <button className="mt-1 block font-bold underline" onClick={onRetry}>
      {label}
    </button>
  );
}

function RetryNotice({ text, onRetry, retry, className }: { text: string; onRetry: () => void; retry: string; className?: string }) {
  return (
    <Notice tone="error" className={className}>
      {text}
      <RetryButton onRetry={onRetry} label={retry} />
    </Notice>
  );
}

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3', tone)}>
      <span className={tone ? '' : 'text-muted'}>{label}</span>
      <span className="text-right font-semibold">{value}</span>
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
  icon: LucideIcon;
  title: string;
  text: string;
  sub?: string;
}) {
  const Icon = icon;
  return (
    <button
      disabled={disabled}
      onClick={() => {
        haptic('select');
        onClick();
      }}
      className={cx('relative flex flex-col items-start rounded-xl p-3 text-left ring-1 transition disabled:opacity-40', active ? 'bg-brand/5 ring-2 ring-brand' : 'ring-line')}
    >
      <Icon className={cx('mb-2 h-6 w-6', active ? 'text-brand' : 'text-muted')} strokeWidth={1.75} />
      {active && <Check className="absolute right-3 top-3 h-4 w-4 text-brand" strokeWidth={2.5} />}
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-muted">{text}</span>
      {sub && <span className="mt-0.5 text-xs text-muted">{sub}</span>}
    </button>
  );
}

function DiscountOption({ active, onClick, icon: Icon, title, text, tag, appliedLabel }: { active: boolean; onClick: () => void; icon: LucideIcon; title: string; text: string; tag: string; appliedLabel: string }) {
  return (
    <button
      onClick={() => {
        haptic('select');
        onClick();
      }}
      className={cx('flex w-full items-center gap-3 rounded-xl p-3 text-left ring-1 transition', active ? 'bg-brand/5 ring-2 ring-brand' : 'ring-line')}
    >
      <Icon className={cx('h-5 w-5 shrink-0', active ? 'text-brand' : 'text-muted')} strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <span className={cx('shrink-0 text-xs font-semibold', active ? 'text-brand' : 'text-muted')}>{active ? appliedLabel : tag}</span>
    </button>
  );
}

/** Checkout sections: plain white blocks with a small heading. */
const BLOCK = 'rounded-2xl bg-surface p-4';
const H2 = 'text-base font-bold';

function Radio({ on }: { on: boolean }) {
  return (
    <span className={cx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-2', on ? 'bg-brand ring-brand' : 'ring-line')}>
      {on && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );
}
