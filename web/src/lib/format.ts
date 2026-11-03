import { getLang, translate } from './i18n';

let currency = 'USD';
export const setCurrency = (c: string) => {
  currency = c;
};

/** $12.26 for USD, 4,000៛ for riel — identical to the server's formatting in both languages. */
export function money(cents: number, cur = currency) {
  if (cur === 'KHR') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))}៛`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(cents / 100);
}

export const orderCode = (id: number) => `#${String(id).padStart(4, '0')}`;

// Browsers ship without Khmer calendar data, so Khmer dates are formatted here (e.g. "2 វិច្ឆិកា, 04:31").
const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const pad = (n: number) => String(n).padStart(2, '0');

const KM_DAYS = ['អាទិត្យ', 'ចន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'];

/** A calendar day like "2026-11-04" → "ថ្ងៃពុធ 4 វិច្ឆិកា" / "Wed, 4 Nov". */
export function dayLabel(ymd: string | null | undefined) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (getLang() === 'km') return `ថ្ងៃ${KM_DAYS[date.getDay()]} ${d} ${KM_MONTHS[m - 1]}`;
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function shortDate(iso: string | Date) {
  const d = new Date(iso);
  if (getLang() === 'km') return `${d.getDate()} ${KM_MONTHS[d.getMonth()]}`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | Date) {
  const d = new Date(iso);
  if (getLang() === 'km') return `${d.getDate()} ${KM_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | Date) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return translate('time.just_now');
  const m = Math.round(s / 60);
  if (m < 60) return translate('time.min_ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return translate('time.h_ago', { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return translate('time.d_ago', { n: d });
  return shortDate(iso);
}

export const greeting = () => {
  const h = new Date().getHours();
  return translate(h < 12 ? 'home.morning' : h < 18 ? 'home.afternoon' : 'home.evening');
};

/** Parse "12.50" / "12,50" into cents. */
export function toCents(v: string): number | null {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
