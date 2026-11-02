import { currentLang, type Lang } from './i18n.js';

/** Same output in Node and browsers (their Khmer locale data differ): $12.26 for USD, 4,000៛ for riel. */
export function formatMoney(cents: number, currency = 'USD', _lang: Lang = currentLang()) {
  if (currency === 'KHR') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))}៛`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export const orderCode = (id: number) => `#${String(id).padStart(4, '0')}`;
