import { dateTime } from '../lib/format';
import { STATUS_META } from '../lib/status';
import type { TimelineStep } from '../lib/types';
import { cx } from './ui';

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const cancelled = s.status === 'cancelled';
        const last = i === steps.length - 1;
        return (
          <li key={s.status} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && <span className={cx('absolute left-[17px] top-9 h-[calc(100%-28px)] w-0.5 rounded', s.done && steps[i + 1]?.done ? 'bg-brand' : 'bg-line')} />}
            <span
              className={cx(
                'relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full text-base',
                cancelled ? 'bg-rose-500 text-white' : s.done ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted',
                s.current && !cancelled && 'animate-pulse-ring',
              )}
            >
              {cancelled ? '✕' : s.done && !s.current ? '✓' : STATUS_META[s.status].emoji}
            </span>
            <div className="pt-1.5">
              <div className={cx('font-semibold', !s.done && 'text-muted', s.current && 'text-ink')}>{s.label}</div>
              {s.at && <div className="text-xs text-muted">{dateTime(s.at)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
