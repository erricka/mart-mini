import { useToasts } from '../lib/toast';
import { cx } from './ui';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            'animate-rise pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg',
            t.tone === 'success' && 'bg-emerald-600 text-white',
            t.tone === 'error' && 'bg-rose-600 text-white',
            t.tone === 'info' && 'bg-ink text-bg',
          )}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
