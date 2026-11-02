import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, cx, Field, Input, Notice, Skeleton, Textarea } from '../../components/ui';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useCart } from '../../lib/cart';
import { money } from '../../lib/format';
import { useAddresses, useShop } from '../../lib/queries';
import { useSession } from '../../lib/session';
import { canRequestContact, haptic, requestTelegramContact } from '../../lib/telegram';
import { toast } from '../../lib/toast';
import type { CouponInfo, OrderDetail, PaymentMethod, User, WalletItem } from '../../lib/types';
import { useCartQuote } from './Cart';

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
  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set synchronously on success so clearing the cart doesn't trigger the empty-cart redirect.
  const placed = useRef(false);

  // Defaults once settings/addresses load.
  useEffect(() => {
    if (!shop.data) return;
    if (!shop.data.deliveryEnabled) setFulfillment('pickup');
    setPayment(shop.data.payments.qrEnabled ? 'qr' : 'cash');
  }, [shop.data]);
  useEffect(() => {
    if (addresses.data && addressId == null) {
      const def = addresses.data.find((a) => a.isDefault) ?? addresses.data[0];
      if (def) setAddressId(def.id);
      else setAddingAddress(true);
    }
  }, [addresses.data, addressId]);

  const discountParams = useMemo(
    () => (discount?.kind === 'reward' ? { customerRewardId: discount.id } : discount?.kind === 'code' ? { couponCode: discount.code } : {}),
    [discount],
  );
  const quoteQ = useCartQuote(fulfillment, discountParams);
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
          paymentMethod: payment,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          addressId: fulfillment === 'delivery' && !addingAddress ? addressId : null,
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
      if (order.status === 'awaiting_payment') navigate(`/orders/${order.id}/pay`, { replace: true });
      else navigate(`/orders/${order.id}?placed=1`, { replace: true });
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
      toast('Phone number verified ✓', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const deliveryReady = fulfillment === 'pickup' || (addingAddress ? newAddress.line1.trim().length >= 3 && newAddress.city.trim().length >= 2 : addressId != null);
  const canPlace = !!q?.canPlace && deliveryReady && contactName.trim() && contactPhone.trim().length >= 5 && !(discount && q?.couponError);
  const s = shop.data;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold tracking-tight">Checkout</h1>

      {/* 1. Delivery or pickup */}
      <section>
        <h2 className="mb-2 font-bold">How would you like your order?</h2>
        <div className="grid grid-cols-2 gap-3">
          <OptionCard
            active={fulfillment === 'delivery'}
            disabled={!s?.deliveryEnabled}
            onClick={() => setFulfillment('delivery')}
            icon="🚚"
            title="Delivery"
            text={!s?.deliveryEnabled ? 'Unavailable today' : q && fulfillment === 'delivery' && q.baseDeliveryFeeCents === 0 ? 'Free' : s ? money(s.deliveryFeeCents) : ''}
          />
          <OptionCard active={fulfillment === 'pickup'} disabled={!s?.pickupEnabled} onClick={() => setFulfillment('pickup')} icon="🏪" title="Pickup" text={s?.pickupEnabled ? 'Free · at the store' : 'Unavailable'} />
        </div>
        {fulfillment === 'pickup' && s && (
          <Card className="mt-3 text-sm">
            <div className="font-semibold">📍 {s.pickupAddress}</div>
            {s.pickupHours && <div className="text-muted">{s.pickupHours}</div>}
            <div className="mt-1 text-muted">We'll message you in Telegram when it's ready.</div>
          </Card>
        )}
      </section>

      {/* 2. Address — only for delivery */}
      {fulfillment === 'delivery' && (
        <section>
          <h2 className="mb-2 font-bold">Delivery address</h2>
          {addresses.isLoading ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="space-y-2">
              {!addingAddress &&
                addresses.data?.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAddressId(a.id)}
                    className={cx('flex w-full items-start gap-3 rounded-2xl bg-surface p-3.5 text-left ring-2 transition', addressId === a.id ? 'ring-brand' : 'ring-line/60')}
                  >
                    <span className="text-xl">{a.label.toLowerCase() === 'work' ? '🏢' : '🏠'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{a.label}</span>
                      <span className="block text-sm text-muted">{[a.line1, a.line2, a.city].filter(Boolean).join(', ')}</span>
                    </span>
                    {addressId === a.id && <span className="text-brand">●</span>}
                  </button>
                ))}
              {addingAddress ? (
                <Card className="space-y-3">
                  <Field label="Street address">
                    <Input value={newAddress.line1} onChange={(e) => setNewAddress({ ...newAddress, line1: e.target.value })} placeholder="House no., street" autoComplete="address-line1" />
                  </Field>
                  <Field label="Apartment, floor (optional)">
                    <Input value={newAddress.line2} onChange={(e) => setNewAddress({ ...newAddress, line2: e.target.value })} autoComplete="address-line2" />
                  </Field>
                  <Field label="City / district">
                    <Input value={newAddress.city} onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })} autoComplete="address-level2" />
                  </Field>
                  <Field label="Directions for the driver (optional)">
                    <Input value={newAddress.instructions} onChange={(e) => setNewAddress({ ...newAddress, instructions: e.target.value })} placeholder="e.g. blue gate, ring twice" />
                  </Field>
                  <p className="text-xs text-muted">Saved to your profile for next time.</p>
                  {(addresses.data?.length ?? 0) > 0 && (
                    <button className="text-sm font-semibold text-muted underline" onClick={() => setAddingAddress(false)}>Use a saved address</button>
                  )}
                </Card>
              ) : (
                <button className="w-full rounded-2xl border-2 border-dashed border-line p-3 text-sm font-semibold text-muted" onClick={() => setAddingAddress(true)}>
                  + Add a new address
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* 3. Contact */}
      <section>
        <h2 className="mb-2 font-bold">Contact</h2>
        <Card className="space-y-3">
          <Field label="Name">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Phone" hint={user?.phoneVerified && contactPhone === user.phone ? '✓ Verified by Telegram' : 'The shop or driver will call this number if needed.'}>
            <Input type="tel" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="tel" placeholder="+855 12 345 678" />
          </Field>
          {!contactPhone && canRequestContact() && (
            <Button variant="secondary" block onClick={shareContact}>📱 Share my Telegram number</Button>
          )}
        </Card>
      </section>

      {/* 4. Rewards & coupons */}
      <section>
        <h2 className="mb-2 font-bold">Rewards & coupons</h2>
        <div className="space-y-2">
          {wallet.map((w) => (
            <DiscountOption
              key={w.id}
              active={discount?.kind === 'reward' && discount.id === w.id}
              onClick={() => setDiscount(discount?.kind === 'reward' && discount.id === w.id ? null : { kind: 'reward', id: w.id })}
              emoji={w.emoji}
              title={w.title}
              text={w.coupon.benefit + (w.coupon.minSubtotalCents ? ` · min ${money(w.coupon.minSubtotalCents)}` : '')}
              tag="Your reward"
            />
          ))}
          {publicCoupons.map((c) => (
            <DiscountOption
              key={c.id}
              active={discount?.kind === 'code' && discount.code === c.code}
              onClick={() => setDiscount(discount?.kind === 'code' && discount.code === c.code ? null : { kind: 'code', code: c.code! })}
              emoji="🏷️"
              title={c.title}
              text={`Code ${c.code}${c.minSubtotalCents ? ` · min ${money(c.minSubtotalCents)}` : ''}`}
              tag="For everyone"
            />
          ))}
          <div className="flex gap-2">
            <Input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} placeholder="Have a coupon code?" className="uppercase" />
            <Button variant="secondary" disabled={!codeInput.trim()} onClick={() => setDiscount({ kind: 'code', code: codeInput.trim() })}>
              Apply
            </Button>
          </div>
          {discount && q?.couponError && <Notice tone="warn">{q.couponError}</Notice>}
          {discount && q?.discount && <Notice tone="success">🎉 {q.discount.label} applied!</Notice>}
          <p className="text-xs text-muted">One reward or coupon per order.</p>
        </div>
      </section>

      {/* 5. Payment */}
      <section>
        <h2 className="mb-2 font-bold">Payment</h2>
        <div className="grid gap-2">
          {s?.payments.qrEnabled && (
            <PayOption
              active={payment === 'qr'}
              onClick={() => setPayment('qr')}
              icon="📱"
              title="Pay now by QR"
              text={s.payments.qrMode === 'simulated' ? 'ABA / KHQR — DEMO: simulated, no money moves' : 'ABA Mobile or any KHQR banking app'}
              tag={s.payments.qrMode === 'simulated' ? 'SIMULATED' : undefined}
            />
          )}
          {s?.payments.cashEnabled && (
            <PayOption
              active={payment === 'cash'}
              onClick={() => setPayment('cash')}
              icon="💵"
              title={fulfillment === 'delivery' ? 'Cash on delivery' : 'Pay at pickup'}
              text={fulfillment === 'delivery' ? 'Pay the driver when your groceries arrive' : 'Pay at the counter when you collect'}
            />
          )}
        </div>
        {payment === 'qr' && <p className="mt-2 text-xs text-muted">Your order is sent to the shop as soon as your payment goes through. Items are held for {s?.payments.paymentWindowMinutes ?? 30} minutes.</p>}
      </section>

      <section>
        <Field label="Note for the shop (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ripe avocados please, no plastic bags" maxLength={500} />
        </Field>
      </section>

      {/* 6. Summary */}
      <section>
        <h2 className="mb-2 font-bold">Order summary</h2>
        <Card className="space-y-2">
          {!q ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              {q.lines.filter((l) => l.isGift).map((l) => (
                <div key="gift" className="flex justify-between text-sm"><span>🎁 {l.name} (gift)</span><span className="font-semibold text-brand">FREE</span></div>
              ))}
              <Row label={`Items (${lines.reduce((n, l) => n + l.quantity, 0)})`} value={money(q.subtotalCents)} />
              {fulfillment === 'delivery' && (
                <Row
                  label="Delivery fee"
                  value={q.baseDeliveryFeeCents === 0 ? 'FREE' : q.deliveryDiscountCents > 0 ? <span><s className="text-muted">{money(q.baseDeliveryFeeCents)}</s> FREE</span> : money(q.baseDeliveryFeeCents)}
                />
              )}
              {q.itemDiscountCents > 0 && <Row label={q.discount?.label ?? 'Discount'} value={`−${money(q.itemDiscountCents)}`} tone="text-brand" />}
              {fulfillment === 'delivery' && q.freeDeliveryRemainingCents != null && q.freeDeliveryRemainingCents > 0 && q.deliveryDiscountCents === 0 && (
                <p className="text-xs text-muted">Add {money(q.freeDeliveryRemainingCents)} more for free delivery.</p>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <span className="font-bold">Total</span>
                <span className="text-2xl font-black">{money(q.totalCents)}</span>
              </div>
              {q.discountCents > 0 && <p className="text-sm font-semibold text-brand">You save {money(q.discountCents)} 🎉</p>}
              {q.pointsEstimate > 0 && (
                <p className="text-sm font-semibold text-amber-600">⭐ +{q.pointsEstimate} points when your order is {fulfillment === 'delivery' ? 'delivered' : 'collected'}</p>
              )}
            </>
          )}
        </Card>
        {q && q.issues.length > 0 && (
          <Notice tone="error" className="mt-3">
            {q.issues.map((i) => <div key={i}>{i}</div>)}
            <Link to="/cart" className="mt-1 inline-block font-bold underline">Review basket</Link>
          </Notice>
        )}
        {error && <Notice tone="error" className="mt-3">{error}</Notice>}
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3">
          <Button block size="lg" disabled={!canPlace} loading={place.isPending} onClick={() => { setError(null); place.mutate(); }}>
            {payment === 'qr' ? 'Continue to payment' : 'Place order'} {q ? `· ${money(q.totalCents)}` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className={cx('flex justify-between', tone)}>
      <span className={tone ? '' : 'text-muted'}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function OptionCard({ active, disabled, onClick, icon, title, text }: { active: boolean; disabled?: boolean; onClick: () => void; icon: string; title: string; text: string }) {
  return (
    <button
      disabled={disabled}
      onClick={() => { haptic('select'); onClick(); }}
      className={cx('flex flex-col items-start rounded-3xl bg-surface p-4 text-left ring-2 transition disabled:opacity-40', active ? 'ring-brand' : 'ring-line/60')}
    >
      <span className="text-3xl">{icon}</span>
      <span className="mt-2 font-bold">{title}</span>
      <span className="text-sm text-muted">{text}</span>
    </button>
  );
}

function PayOption({ active, onClick, icon, title, text, tag }: { active: boolean; onClick: () => void; icon: string; title: string; text: string; tag?: string }) {
  return (
    <button onClick={() => { haptic('select'); onClick(); }} className={cx('flex items-center gap-3 rounded-2xl bg-surface p-3.5 text-left ring-2 transition', active ? 'ring-brand' : 'ring-line/60')}>
      <span className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-2xl">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-bold">{title}{tag && <Badge className="bg-amber-100 text-amber-900">{tag}</Badge>}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <span className={cx('h-5 w-5 rounded-full border-2', active ? 'border-brand bg-brand shadow-[inset_0_0_0_3px_var(--surface)]' : 'border-line')} />
    </button>
  );
}

function DiscountOption({ active, onClick, emoji, title, text, tag }: { active: boolean; onClick: () => void; emoji: string; title: string; text: string; tag: string }) {
  return (
    <button onClick={() => { haptic('select'); onClick(); }} className={cx('flex w-full items-center gap-3 rounded-2xl p-3.5 text-left ring-2 transition', active ? 'bg-amber-50 ring-amber-400 dark:bg-amber-500/10' : 'bg-surface ring-line/60')}>
      <span className="text-2xl">{emoji}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
      <span className="text-xs font-bold text-muted">{active ? '✓ Applied' : tag}</span>
    </button>
  );
}
