export function formatMoney(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export const orderCode = (id: number) => `#${String(id).padStart(4, '0')}`;
