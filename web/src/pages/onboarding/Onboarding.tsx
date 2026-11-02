/**
 * First-time customer onboarding (after scanning the store/receipt QR):
 * Welcome → About you (name + optional phone) → Privacy → Celebration → Start shopping.
 * The account and loyalty membership are created only when the customer accepts the privacy notice.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, celebrate, CountUp, Field, Input, Notice, ProgressBar, cx } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { useShop } from '../../lib/queries';
import { useSession, type Prefill } from '../../lib/session';
import { canRequestContact, haptic, needsWriteAccess, requestBotMessages, requestTelegramContact, useTelegramBackButton } from '../../lib/telegram';
import type { Progress, User, WalletItem } from '../../lib/types';
import { BrandMark } from './Entry';

type Step = 'welcome' | 'about' | 'privacy' | 'done';

interface CompleteResponse {
  status: 'created' | 'existing';
  token: string;
  user: User;
  welcome: { pointsAwarded: number; welcomeCoupon: { title: string; benefit: string } | null; skippedReason: 'phone_already_used' | null; level: { name: string; emoji: string } } | null;
  loyalty: { balance: number; level: { name: string; emoji: string }; progress: Progress | null; wallet: WalletItem[] };
}

function Dots({ step }: { step: Step }) {
  const order: Step[] = ['about', 'privacy', 'done'];
  const i = order.indexOf(step);
  return (
    <div className="flex justify-center gap-2" aria-label={`Step ${i + 1} of 3`}>
      {order.map((s, k) => (
        <span key={s} className={cx('h-2 rounded-full transition-all', k <= i ? 'w-8 bg-brand' : 'w-2 bg-line')} />
      ))}
    </div>
  );
}

export function Onboarding({ token, prefill }: { token: string; prefill: Prefill }) {
  const shop = useShop();
  const { finishOnboarding } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [firstName, setFirstName] = useState(prefill.firstName ?? '');
  const [lastName, setLastName] = useState(prefill.lastName ?? '');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState<{ response: string; phone: string | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteResponse | null>(null);
  const [askUpdates, setAskUpdates] = useState(needsWriteAccess());

  const teaser = shop.data?.loyalty;
  const shopName = shop.data?.shopName ?? 'Sunny Market';

  useTelegramBackButton(step === 'about' ? () => setStep('welcome') : step === 'privacy' ? () => setStep('about') : null);

  async function shareContact() {
    setSharing(true);
    setError(null);
    const r = await requestTelegramContact();
    setSharing(false);
    if (r) {
      haptic('success');
      setContact(r);
      setPhone('');
    } else {
      setError('No problem — you can type your number instead, or skip for now.');
    }
  }

  async function complete() {
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<CompleteResponse>('/onboarding/complete', {
        token,
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          phone: contact ? null : phone.trim() || null,
          contactResponse: contact?.response ?? null,
          acceptPrivacy: agree,
        },
      });
      setResult(r);
      setStep('done');
      setTimeout(celebrate, 250);
    } catch (e) {
      setError(errorMessage(e));
      // If the shared contact couldn't be verified, fall back to manual entry.
      if ((e as { code?: string }).code === 'contact_unverified') setContact(null);
    } finally {
      setSubmitting(false);
    }
  }

  const startShopping = () => {
    if (!result) return;
    finishOnboarding(result.token, result.user);
    navigate('/shop', { replace: true });
  };

  // ---------- Welcome ----------
  if (step === 'welcome') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-12">
        <div className="flex flex-1 flex-col items-center text-center">
          <BrandMark />
          <h1 className="animate-rise mt-6 text-3xl font-extrabold tracking-tight">Welcome to {shopName}!</h1>
          <p className="animate-rise mt-2 text-muted">{shop.data?.tagline ?? 'Fresh groceries, happy rewards'}</p>
          <ul className="mt-8 w-full space-y-3 text-left">
            {[
              ['🛒', 'Order groceries in Telegram', 'Delivery to your door or pickup at the store.'],
              ['⭐', 'Earn points on every basket', `${teaser?.pointsPerDollar ?? 1} point for every ${money(100)} you spend.`],
              [
                '🎁',
                teaser?.signupBonusPoints ? `${teaser.signupBonusPoints} bonus points to start` : 'Unlock fun rewards',
                teaser?.welcomeCoupon ? `Plus a welcome gift: ${teaser.welcomeCoupon.title}.` : 'Free delivery, surprise gifts and more.',
              ],
            ].map(([icon, title, text], i) => (
              <li key={title} className="animate-rise flex gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line/60" style={{ animationDelay: `${i * 80}ms` }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-2xl">{icon}</span>
                <span>
                  <span className="block font-bold">{title}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Button size="lg" block className="mt-8" onClick={() => setStep('about')}>
          Get Started
        </Button>
        <p className="mt-3 text-center text-xs text-muted">Takes less than a minute.</p>
      </div>
    );
  }

  // ---------- About you ----------
  if (step === 'about') {
    const phoneShown = contact?.phone ? `+${contact.phone.replace(/^\+/, '')}` : null;
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-8">
        <Dots step="about" />
        <div className="mt-8 flex flex-col items-center text-center">
          <Avatar name={`${firstName} ${lastName}`} url={prefill.photoUrl} size={84} />
          <h1 className="mt-4 text-2xl font-extrabold">Nice to meet you!</h1>
          <p className="text-sm text-muted">We filled this in from Telegram — change anything you like.</p>
        </div>
        <div className="mt-6 space-y-4">
          <Field label="First name">
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={64} />
          </Field>
          <Field label="Last name (optional)">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={64} />
          </Field>
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line/60">
            <div className="font-semibold">Phone number <span className="font-normal text-muted">(optional)</span></div>
            <p className="mb-3 text-xs text-muted">Only used so the shop or driver can reach you about your orders. You'll need it at checkout.</p>
            {contact ? (
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10">
                <span className="font-semibold">{phoneShown ?? 'Shared from Telegram'}</span>
                <Badge className="bg-emerald-600 text-white">✓ via Telegram</Badge>
              </div>
            ) : (
              <>
                {canRequestContact() && (
                  <Button block variant="secondary" loading={sharing} onClick={shareContact} className="mb-3">
                    📱 Share my Telegram number
                  </Button>
                )}
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder={canRequestContact() ? 'or type it, e.g. +855 12 345 678' : 'e.g. +855 12 345 678'}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </>
            )}
            {contact && (
              <button className="mt-2 text-xs font-semibold text-muted underline" onClick={() => setContact(null)}>
                Use a different number
              </button>
            )}
          </div>
          {error && <Notice tone="warn">{error}</Notice>}
        </div>
        <div className="mt-auto pt-6">
          <Button size="lg" block disabled={!firstName.trim()} onClick={() => { setError(null); setStep('privacy'); }}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Privacy ----------
  if (step === 'privacy') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-8">
        <Dots step="privacy" />
        <div className="mt-8 text-center">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-extrabold">Your privacy</h1>
          <p className="text-sm text-muted">The short version:</p>
        </div>
        <ul className="mt-6 space-y-3 text-sm">
          {[
            ['🗂️', 'What we keep', 'Your name, Telegram ID and photo, phone (if you share it), delivery addresses, orders and points.'],
            ['🎯', 'Why', 'To prepare and deliver your orders, contact you about them, and run your rewards.'],
            ['🚫', 'What we never do', "We don't sell your data or send ads from other companies."],
            ['✏️', 'Your control', `Edit your details any time in Profile. To delete your account, contact ${shop.data?.supportPhone || 'the shop'}.`],
          ].map(([icon, title, text]) => (
            <li key={title} className="flex gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line/60">
              <span className="text-xl">{icon}</span>
              <span>
                <span className="block font-bold">{title}</span>
                <span className="text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-2 p-4">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
          <span className="text-sm font-semibold">I agree to the privacy notice and want to join the {shopName} rewards club.</span>
        </label>
        {error && <Notice tone="error" className="mt-3">{error}</Notice>}
        <div className="mt-auto pt-6">
          <Button size="lg" block disabled={!agree} loading={submitting} onClick={complete}>
            Create my membership
          </Button>
        </div>
      </div>
    );
  }

  // ---------- Celebration ----------
  const r = result!;
  const progress = r.loyalty.progress;
  const welcomeCoupon = r.loyalty.wallet.find((w) => w.source === 'welcome');
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-8">
      <Dots step="done" />
      <div className="mt-8 flex flex-col items-center text-center">
        <div className="animate-wiggle text-6xl">🎉</div>
        <h1 className="mt-3 text-2xl font-extrabold">
          {r.status === 'existing' ? `Welcome back, ${r.user.firstName}!` : `You're in, ${r.user.firstName}!`}
        </h1>
        <p className="text-sm text-muted">Your {shopName} membership is ready.</p>
      </div>

      <div className="animate-rise mt-6 rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 p-5 text-amber-950 shadow-lg shadow-orange-900/10">
        <div className="flex items-center justify-between">
          <Badge className="bg-white/40">{r.loyalty.level.emoji} {r.loyalty.level.name}</Badge>
          {r.welcome?.pointsAwarded ? <Badge className="bg-white/40">+{r.welcome.pointsAwarded} welcome bonus</Badge> : null}
        </div>
        <div className="mt-3 text-5xl font-black tabular-nums">
          <CountUp value={r.loyalty.balance} duration={1400} /> <span className="text-xl font-bold">points</span>
        </div>
        {progress && (
          <>
            <ProgressBar percent={progress.percent} className="mt-4 bg-white/40" tone="brand" />
            <p className="mt-2 text-sm font-semibold">
              {progress.remaining} more points to unlock {progress.emoji} {progress.title}!
            </p>
          </>
        )}
      </div>

      {welcomeCoupon && (
        <div className="animate-rise mt-4 flex items-center gap-3 rounded-3xl border-2 border-dashed border-brand/50 bg-surface p-4" style={{ animationDelay: '150ms' }}>
          <span className="text-3xl">🎟️</span>
          <span>
            <span className="block font-bold">{welcomeCoupon.title}</span>
            <span className="block text-sm text-muted">{welcomeCoupon.coupon.description || welcomeCoupon.coupon.benefit} — apply it at checkout.</span>
          </span>
        </div>
      )}
      {askUpdates && (
        <button
          onClick={async () => {
            const ok = await requestBotMessages();
            setAskUpdates(false);
            if (ok) haptic('success');
          }}
          className="animate-rise mt-4 flex w-full items-center gap-3 rounded-3xl bg-sky-50 p-4 text-left dark:bg-sky-500/10"
        >
          <span className="text-3xl">🔔</span>
          <span>
            <span className="block font-bold">Get order updates in Telegram</span>
            <span className="block text-sm text-muted">We'll message you when your order is confirmed, on its way, and when you earn rewards. Tap to allow.</span>
          </span>
        </button>
      )}
      {r.welcome?.skippedReason === 'phone_already_used' && (
        <Notice tone="info" className="mt-4">
          Welcome gifts were already claimed with this phone number, but you'll earn points on every order from now on.
        </Notice>
      )}

      <div className="mt-auto pt-8">
        <Button size="lg" block onClick={startShopping}>
          Start Shopping 🛒
        </Button>
      </div>
    </div>
  );
}
