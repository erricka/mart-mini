import confetti from 'canvas-confetti';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { haptic } from '../lib/telegram';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'sun';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-brand text-brand-ink shadow-sm shadow-green-900/10 hover:brightness-105 active:brightness-95',
  secondary: 'bg-surface-2 text-ink hover:brightness-[0.98] active:brightness-95',
  ghost: 'bg-transparent text-ink hover:bg-surface-2',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  sun: 'bg-amber-400 text-amber-950 hover:bg-amber-300',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  block,
  className,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; block?: boolean }) {
  return (
    <button
      {...rest}
      onClick={(e) => {
        haptic('light');
        onClick?.(e);
      }}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' && 'min-h-9 px-3 text-sm',
        size === 'md' && 'min-h-12 px-5',
        size === 'lg' && 'min-h-14 px-6 text-lg',
        block && 'w-full',
        BTN[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} className={cx('rounded-3xl bg-surface p-4 shadow-sm shadow-black/[0.03] ring-1 ring-line/60', className)}>
    {children}
  </div>
);

export const Badge = ({ className, children }: { className?: string; children: ReactNode }) => (
  <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>
);

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cx('animate-spin', className ?? 'h-6 w-6')} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
    <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton rounded-2xl', className)} />;

export function EmptyState({ emoji, title, text, action }: { emoji: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="animate-rise flex flex-col items-center px-6 py-14 text-center">
      <div className="animate-float mb-4 text-6xl">{emoji}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 text-5xl">😕</div>
      <h3 className="font-bold">Oops — that didn't load</h3>
      <p className="mt-1 max-w-xs text-sm text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export const PageLoader = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted">
    <Spinner />
    <span className="text-sm">{label}</span>
  </div>
);

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'w-full rounded-2xl border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/15';
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, 'min-h-20', className)} />;
export const Select = ({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(inputCls, 'appearance-none pr-9', className)}>
    {children}
  </select>
);

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
      </span>
    </button>
  );
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'animate-sheet pb-safe max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        {title && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted" aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ percent, className, tone = 'sun' }: { percent: number; className?: string; tone?: 'sun' | 'brand' }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setW(Math.max(0, Math.min(100, percent))));
    return () => cancelAnimationFrame(t);
  }, [percent]);
  return (
    <div className={cx('h-3 overflow-hidden rounded-full bg-black/10 dark:bg-white/10', className)} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-1000 ease-out',
          tone === 'sun' ? 'bg-gradient-to-r from-amber-300 via-amber-400 to-orange-400' : 'bg-gradient-to-r from-green-400 to-emerald-500',
        )}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/** Animated number that counts up when it changes. */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown.toLocaleString()}</>;
}

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (url && !broken) {
    return <img src={url} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover ring-2 ring-white/70" style={{ width: size, height: size }} />;
  }
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 font-bold text-white ring-2 ring-white/70"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || '🙂'}
    </div>
  );
}

export function celebrate() {
  haptic('success');
  const colors = ['#22c55e', '#facc15', '#fb923c', '#38bdf8', '#f472b6'];
  confetti({ particleCount: 90, spread: 75, origin: { y: 0.65 }, colors, disableForReducedMotion: true });
  setTimeout(() => confetti({ particleCount: 50, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, disableForReducedMotion: true }), 200);
  setTimeout(() => confetti({ particleCount: 50, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, disableForReducedMotion: true }), 350);
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between">
      <h2 className="text-lg font-extrabold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export const Notice = ({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; className?: string }) => (
  <div
    className={cx(
      'rounded-2xl px-4 py-3 text-sm',
      tone === 'info' && 'bg-sky-50 text-sky-900 dark:bg-sky-500/10 dark:text-sky-200',
      tone === 'warn' && 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
      tone === 'error' && 'bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200',
      tone === 'success' && 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
      className,
    )}
  >
    {children}
  </div>
);
