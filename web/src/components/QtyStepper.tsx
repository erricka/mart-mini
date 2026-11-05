import { Minus, Plus, Trash2 } from 'lucide-react';
import { useT } from '../lib/i18n';
import { haptic } from '../lib/telegram';
import { cx } from './ui';

export function QtyStepper({ value, max, onChange, size = 'md' }: { value: number; max: number; onChange: (v: number) => void; size?: 'sm' | 'md' }) {
  const { t } = useT();
  const btn = cx('grid place-items-center rounded-full transition active:scale-90 disabled:opacity-30', size === 'sm' ? 'h-8 w-8' : 'h-10 w-10');
  const icon = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  return (
    <div className={cx('flex items-center rounded-full bg-surface ring-1 ring-line', size === 'sm' ? 'gap-0.5' : 'gap-1.5')}>
      <button
        type="button"
        aria-label={t('common.decrease')}
        className={cx(btn, 'text-ink')}
        onClick={() => {
          haptic('select');
          onChange(value - 1);
        }}
      >
        {value <= 1 ? <Trash2 className={icon} strokeWidth={1.9} /> : <Minus className={icon} strokeWidth={2.2} />}
      </button>
      <span className={cx('min-w-5 text-center font-bold tabular-nums', size === 'sm' ? 'text-sm' : 'text-base')}>{value}</span>
      <button
        type="button"
        aria-label={t('common.increase')}
        disabled={value >= max}
        className={cx(btn, 'text-brand')}
        onClick={() => {
          haptic('select');
          onChange(value + 1);
        }}
      >
        <Plus className={icon} strokeWidth={2.4} />
      </button>
    </div>
  );
}
