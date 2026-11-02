import { useQueryClient } from '@tanstack/react-query';
import { useLangStore, useT, type Lang } from '../lib/i18n';
import { useSession } from '../lib/session';
import { haptic } from '../lib/telegram';
import { cx } from './ui';

/** Compact ខ្មែរ | English toggle. Saves to the account when signed in. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, t } = useT();
  const session = useSession();
  const qc = useQueryClient();
  const set = async (l: Lang) => {
    if (l === lang) return;
    haptic('select');
    if (session.user) await session.changeLanguage(l);
    else useLangStore.getState().setLang(l);
    // Product names, rewards and messages come from the server in the chosen language.
    void qc.invalidateQueries();
  };
  return (
    <div className={cx('inline-flex rounded-full bg-surface-2 p-1', className)} role="group" aria-label={t('lang.label')}>
      {(['km', 'en'] as const).map((l) => (
        <button key={l} onClick={() => set(l)} className={cx('rounded-full px-3.5 py-1.5 text-sm font-semibold transition', lang === l ? 'bg-ink text-bg' : 'text-muted')}>
          {l === 'km' ? 'ខ្មែរ' : 'English'}
        </button>
      ))}
    </div>
  );
}
