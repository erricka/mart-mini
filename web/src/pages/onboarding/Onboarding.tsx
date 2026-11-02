/**
 * First-time customer onboarding (after scanning the store/receipt QR):
 * Language → Welcome → About you (name + optional phone) → Privacy → Celebration → Start shopping.
 * The account and loyalty membership are created only when the customer accepts the privacy notice.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, celebrate, CountUp, cx, Field, Input, Notice, ProgressBar } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/format';
import { useLangStore, useT, type Lang } from '../../lib/i18n';
import { useShop } from '../../lib/queries';
import { useSession, type Prefill } from '../../lib/session';
import { canRequestContact, haptic, needsWriteAccess, requestBotMessages, requestTelegramContact, useTelegramBackButton } from '../../lib/telegram';
import type { Progress, User, WalletItem } from '../../lib/types';
import { BrandMark } from './Entry';

type Step = 'language' | 'welcome' | 'about' | 'privacy' | 'done';

interface CompleteResponse {
  status: 'created' | 'existing';
  token: string;
  user: User;
  welcome: { pointsAwarded: number; welcomeCoupon: { title: string; benefit: string } | null; skippedReason: 'phone_already_used' | null; level: { name: string; emoji: string } } | null;
  loyalty: { balance: number; level: { name: string; emoji: string }; progress: Progress | null; wallet: WalletItem[] };
}

function Dots({ step }: { step: Step }) {
  const { t } = useT();
  const order: Step[] = ['about', 'privacy', 'done'];
  const i = order.indexOf(step);
  return (
    <div className="flex justify-center gap-2" aria-label={t('ob.step', { n: i + 1 })}>
      {order.map((s, k) => (
        <span key={s} className={cx('h-2 rounded-full transition-all', k <= i ? 'w-8 bg-brand' : 'w-2 bg-line')} />
      ))}
    </div>
  );
}

export function Onboarding({ token, prefill }: { token: string; prefill: Prefill }) {
  const shop = useShop();
  const { t, lang } = useT();
  const setLang = useLangStore((s) => s.setLang);
  const { finishOnboarding } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('language');
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
  const shopName = shop.data?.shopName ?? 'mart25';

  useTelegramBackButton(
    step === 'welcome' ? () => setStep('language') : step === 'about' ? () => setStep('welcome') : step === 'privacy' ? () => setStep('about') : null,
  );

  const chooseLanguage = (l: Lang) => {
    haptic('select');
    setLang(l);
    void shop.refetch(); // shop tagline & welcome gift text in the chosen language
    setStep('welcome');
  };

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
      setError(t('ob.share_declined'));
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
          languageCode: lang,
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

  // ---------- Language (shown in both languages so everyone can read it) ----------
  if (step === 'language') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-16">
        <div className="flex flex-1 flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">{shopName}</h1>
          <p className="mt-3 text-lg font-semibold">ជ្រើសរើសភាសា</p>
          <p className="text-muted">Choose your language</p>
          <div className="mt-8 grid w-full gap-3">
            {([
              ['km', '🇰🇭', 'ភាសាខ្មែរ', 'Khmer'],
              ['en', '🇬🇧', 'English', 'អង់គ្លេស'],
            ] as const).map(([code, flag, name, other]) => (
              <button
                key={code}
                onClick={() => chooseLanguage(code)}
                className={cx(
                  'animate-rise flex items-center gap-4 rounded-3xl bg-surface p-5 text-left ring-2 transition active:scale-[0.98]',
                  lang === code ? 'ring-brand' : 'ring-line/60',
                )}
              >
                <span className="text-4xl">{flag}</span>
                <span className="flex-1">
                  <span className="block text-xl font-extrabold">{name}</span>
                  <span className="block text-sm text-muted">{other}</span>
                </span>
                <span className="text-2xl text-muted">›</span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted">អាចប្តូរបានពេលក្រោយក្នុង «គណនី» · You can change this later in Profile</p>
      </div>
    );
  }

  // ---------- Welcome ----------
  if (step === 'welcome') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-12">
        <div className="flex flex-1 flex-col items-center text-center">
          <BrandMark />
          <h1 className="animate-rise mt-6 text-3xl font-extrabold tracking-tight">{t('ob.welcome_title', { shop: shopName })}</h1>
          <p className="animate-rise mt-2 text-muted">{shop.data?.tagline}</p>
          <ul className="mt-8 w-full space-y-3 text-left">
            {[
              ['🛒', t('ob.perk1_title'), t('ob.perk1_text')],
              ['⭐', t('ob.perk2_title'), t('ob.perk2_text', { n: teaser?.pointsPerDollar ?? 1, amount: money(100) })],
              [
                '🎁',
                teaser?.signupBonusPoints ? t('ob.perk3_bonus', { n: teaser.signupBonusPoints }) : t('ob.perk3_rewards'),
                teaser?.welcomeCoupon ? t('ob.perk3_gift', { gift: teaser.welcomeCoupon.title }) : t('ob.perk3_more'),
              ],
            ].map(([icon, title, text], i) => (
              <li key={i} className="animate-rise flex gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line/60" style={{ animationDelay: `${i * 80}ms` }}>
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
          {t('ob.get_started')}
        </Button>
        <p className="mt-3 text-center text-xs text-muted">{t('ob.takes_minute')}</p>
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
          <h1 className="mt-4 text-2xl font-extrabold">{t('ob.nice')}</h1>
          <p className="text-sm text-muted">{t('ob.prefilled')}</p>
        </div>
        <div className="mt-6 space-y-4">
          <Field label={t('ob.first_name')}>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" maxLength={64} />
          </Field>
          <Field label={t('ob.last_name')}>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" maxLength={64} />
          </Field>
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line/60">
            <div className="font-semibold">
              {t('ob.phone_title')} <span className="font-normal text-muted">{t('ob.optional')}</span>
            </div>
            <p className="mb-3 text-xs text-muted">{t('ob.phone_why')}</p>
            {contact ? (
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10">
                <span className="font-semibold">{phoneShown ?? t('ob.shared')}</span>
                <Badge className="bg-emerald-600 text-white">{t('ob.via_telegram')}</Badge>
              </div>
            ) : (
              <>
                {canRequestContact() && (
                  <Button block variant="secondary" loading={sharing} onClick={shareContact} className="mb-3">
                    {t('ob.share_phone')}
                  </Button>
                )}
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder={canRequestContact() ? t('ob.or_type') : t('ob.type_eg')}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </>
            )}
            {contact && (
              <button className="mt-2 text-xs font-semibold text-muted underline" onClick={() => setContact(null)}>
                {t('ob.use_different')}
              </button>
            )}
          </div>
          {error && <Notice tone="warn">{error}</Notice>}
        </div>
        <div className="mt-auto pt-6">
          <Button
            size="lg"
            block
            disabled={!firstName.trim()}
            onClick={() => {
              setError(null);
              setStep('privacy');
            }}
          >
            {t('common.continue')}
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
          <h1 className="mt-3 text-2xl font-extrabold">{t('ob.privacy_title')}</h1>
          <p className="text-sm text-muted">{t('ob.privacy_short')}</p>
        </div>
        <ul className="mt-6 space-y-3 text-sm">
          {[
            ['🗂️', t('privacy.keep_title'), t('privacy.keep_text')],
            ['🎯', t('privacy.why_title'), t('privacy.why_text')],
            ['🚫', t('privacy.never_title'), t('privacy.never_text')],
            ['✏️', t('privacy.control_title'), t('privacy.control_text', { contact: shop.data?.supportPhone || t('privacy.the_shop') })],
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
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--brand)]" />
          <span className="text-sm font-semibold">{t('ob.agree', { shop: shopName })}</span>
        </label>
        {error && (
          <Notice tone="error" className="mt-3">
            {error}
          </Notice>
        )}
        <div className="mt-auto pt-6">
          <Button size="lg" block disabled={!agree} loading={submitting} onClick={complete}>
            {t('ob.create')}
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
        <h1 className="mt-3 text-2xl font-extrabold">{r.status === 'existing' ? t('ob.welcome_back', { name: r.user.firstName }) : t('ob.youre_in', { name: r.user.firstName })}</h1>
        <p className="text-sm text-muted">{t('ob.ready', { shop: shopName })}</p>
      </div>

      <div className="animate-rise mt-6 rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-orange-400 p-5 text-amber-950 shadow-lg shadow-orange-900/10">
        <div className="flex items-center justify-between gap-2">
          <Badge className="bg-white/40">
            {r.loyalty.level.emoji} {r.loyalty.level.name}
          </Badge>
          {r.welcome?.pointsAwarded ? <Badge className="bg-white/40">{t('ob.welcome_bonus', { n: r.welcome.pointsAwarded })}</Badge> : null}
        </div>
        <div className="mt-3 text-5xl font-black tabular-nums">
          <CountUp value={r.loyalty.balance} duration={1400} /> <span className="text-xl font-bold">{t('common.points')}</span>
        </div>
        {progress && (
          <>
            <ProgressBar percent={progress.percent} className="mt-4 bg-white/40" tone="brand" />
            <p className="mt-2 text-sm font-semibold">{t('ob.more_to_unlock', { n: progress.remaining, reward: `${progress.emoji} ${progress.title}` })}</p>
          </>
        )}
      </div>

      {welcomeCoupon && (
        <div className="animate-rise mt-4 flex items-center gap-3 rounded-3xl border-2 border-dashed border-brand/50 bg-surface p-4" style={{ animationDelay: '150ms' }}>
          <span className="text-3xl">🎟️</span>
          <span>
            <span className="block font-bold">{welcomeCoupon.title}</span>
            <span className="block text-sm text-muted">{t('ob.apply_at_checkout', { text: welcomeCoupon.coupon.description || welcomeCoupon.coupon.benefit })}</span>
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
            <span className="block font-bold">{t('ob.updates_title')}</span>
            <span className="block text-sm text-muted">{t('ob.updates_text')}</span>
          </span>
        </button>
      )}
      {r.welcome?.skippedReason === 'phone_already_used' && (
        <Notice tone="info" className="mt-4">
          {t('ob.phone_used')}
        </Notice>
      )}

      <div className="mt-auto pt-8">
        <Button size="lg" block onClick={startShopping}>
          {t('ob.start_shopping')}
        </Button>
      </div>
    </div>
  );
}
