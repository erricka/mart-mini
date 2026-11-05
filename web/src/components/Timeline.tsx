import { Check, X } from 'lucide-react';
import { dateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { STATUS_META } from '../lib/status';
import type { TimelineStep } from '../lib/types';
import { cx } from './ui';

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  const { t } = useT();
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
                'relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full',
                cancelled ? 'bg-rose-500 text-white' : s.done ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted',
                s.current && !cancelled && 'ring-4 ring-brand/15',
              )}
            >
              {cancelled ? <X className="h-4 w-4" strokeWidth={2.5} /> : s.done && !s.current ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <StepIcon status={s.status} />}
            </span>
            <div className="pt-1.5">
              <div className={cx('font-semibold', !s.done && 'text-muted', s.current && 'text-ink')}>{t(`status.${s.status}`)}</div>
              {s.at && <div className="text-xs text-muted">{dateTime(s.at)}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ status }: { status: TimelineStep['status'] }) {
  const Icon = STATUS_META[status].icon;
  return <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />;
}
