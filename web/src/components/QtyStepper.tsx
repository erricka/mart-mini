import { haptic } from '../lib/telegram';
import { cx } from './ui';

export function QtyStepper({ value, max, onChange, size = 'md' }: { value: number; max: number; onChange: (v: number) => void; size?: 'sm' | 'md' }) {
  const btn = cx('grid place-items-center rounded-full font-bold transition active:scale-90 disabled:opacity-40', size === 'sm' ? 'h-8 w-8 text-lg' : 'h-11 w-11 text-xl');
  return (
    <div className={cx('flex items-center rounded-full bg-surface-2', size === 'sm' ? 'gap-1 p-0.5' : 'gap-2 p-1')}>
      <button
        type="button"
        aria-label="Decrease quantity"
        className={cx(btn, 'bg-surface text-ink shadow-sm')}
        onClick={() => {
          haptic('select');
          onChange(value - 1);
        }}
      >
        {value <= 1 ? '🗑' : '−'}
      </button>
      <span className={cx('min-w-6 text-center font-bold tabular-nums', size === 'md' && 'text-lg')}>{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={value >= max}
        className={cx(btn, 'bg-brand text-brand-ink shadow-sm')}
        onClick={() => {
          haptic('select');
          onChange(value + 1);
        }}
      >
        +
      </button>
    </div>
  );
}
