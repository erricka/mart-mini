let currency = 'USD';
export const setCurrency = (c: string) => {
  currency = c;
};

export function money(cents: number, cur = currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(cents / 100);
}

export const orderCode = (id: number) => `#${String(id).padStart(4, '0')}`;

export function shortDate(iso: string | Date) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | Date) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | Date) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  return shortDate(iso);
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/** Parse "12.50" / "12,50" into cents. */
export function toCents(v: string): number | null {
  const n = Number(v.replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
