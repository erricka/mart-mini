/** Settings → Recent admin activity: every change made in the dashboard (who, what, when). Admins only. */
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useT, type TKey } from '../../lib/i18n';

interface Entry {
  id: number;
  method: string;
  path: string;
  status: number;
  at: string;
  name: string | null;
}

/** Method + path → a plain sentence key ("Deleted products"). */
const ACTIONS: [string, RegExp, TKey][] = [
  ['POST', /^\/api\/admin\/products\/import$/, 'log.import'],
  ['POST', /^\/api\/admin\/products\/delete$/, 'log.delete_products'],
  ['POST', /^\/api\/admin\/products\/photos$/, 'log.photos'],
  ['PUT', /^\/api\/admin\/products\/\d+\/photo$/, 'log.photos'],
  ['POST', /^\/api\/admin\/products\/\d+\/stock$/, 'log.stock'],
  ['DELETE', /^\/api\/admin\/products\/\d+$/, 'log.delete_product'],
  ['POST', /^\/api\/admin\/products$/, 'log.add_product'],
  ['PUT', /^\/api\/admin\/products\/\d+$/, 'log.edit_product'],
  ['POST', /^\/api\/admin\/uploads$/, 'log.photos'],
  ['POST', /^\/api\/admin\/categories$/, 'log.add_category'],
  ['PUT', /^\/api\/admin\/categories\/\d+$/, 'log.edit_category'],
  ['DELETE', /^\/api\/admin\/categories\/\d+$/, 'log.delete_category'],
  ['POST', /^\/api\/admin\/orders\/\d+\/status$/, 'log.order_status'],
  ['POST', /^\/api\/admin\/orders\/\d+\/payment$/, 'log.order_payment'],
  ['POST', /^\/api\/admin\/orders\/\d+\/notes$/, 'log.order_note'],
  ['PUT', /^\/api\/admin\/customers\/\d+\/role$/, 'log.role'],
  ['DELETE', /^\/api\/admin\/customers\/\d+$/, 'log.remove_customer'],
  ['POST', /^\/api\/admin\/customers\/\d+\/points$/, 'log.points'],
  ['PUT', /^\/api\/admin\/settings$/, 'log.settings'],
  ['POST', /^\/api\/admin\/branches$/, 'log.add_branch'],
  ['PUT', /^\/api\/admin\/branches\/\d+$/, 'log.edit_branch'],
  ['DELETE', /^\/api\/admin\/branches\/\d+$/, 'log.delete_branch'],
];

export function ActivityLog() {
  const { t } = useT();
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<{ entries: Entry[] }>('/admin/audit').then((r) => r.entries) });
  const describe = (e: Entry) => {
    const hit = ACTIONS.find(([m, re]) => m === e.method && re.test(e.path));
    return hit ? t(hit[2]) : t('log.other');
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-5 w-5 text-brand" />
        {t('log.title')}
      </div>
      <p className="text-sm text-muted">{t('log.hint')}</p>
      {q.isLoading ? (
        <Skeleton className="h-24" />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">{t('log.none')}</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-auto rounded-2xl text-sm ring-1 ring-line">
          {q.data.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="font-semibold">{e.name ?? '—'}</span> · {describe(e)}
                {e.status >= 400 && <span className="text-rose-600"> · {t('log.refused')}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted">{dateTime(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
