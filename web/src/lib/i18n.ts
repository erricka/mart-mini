/** App translations — Khmer (default) and English. Customers choose on the first screen; changeable in Profile. */
import { create } from 'zustand';
import { en } from '../i18n/en';
import { enAdmin } from '../i18n/en-admin';
import { km } from '../i18n/km';
import { kmAdmin } from '../i18n/km-admin';

export type Lang = 'km' | 'en';
const EN = { ...en, ...enAdmin };
export type TKey = keyof typeof EN;
const KM: Record<TKey, string> = { ...km, ...kmAdmin };
const DICT: Record<Lang, Record<TKey, string>> = { en: EN, km: KM };
const STORAGE = 'mart25-lang';

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE);
    return v === 'km' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

let current: Lang = stored() ?? 'km';
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLang = () => current;
export const parseLang = (v: unknown): Lang | null => (v === 'km' || v === 'en' ? v : null);

interface LangState {
  lang: Lang;
  setLang(l: Lang): void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: current,
  setLang(l) {
    current = l;
    try {
      localStorage.setItem(STORAGE, l);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = l;
    set({ lang: l });
  },
}));

export function translate(key: TKey, vars?: Record<string, string | number>, lang: Lang = current): string {
  const tpl = DICT[lang][key] ?? EN[key] ?? key;
  return vars ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : tpl;
}

/** Hook: re-renders when the language changes. */
export function useT() {
  const lang = useLangStore((s) => s.lang);
  return { lang, t: (key: TKey, vars?: Record<string, string | number>) => translate(key, vars, lang) };
}
