export interface NormalizedPhone {
  /** What we show and store, e.g. "+1 555 123 4567" or "+15551234567". */
  display: string;
  /** Digits only; used to detect the same number across accounts. */
  key: string;
}

/**
 * Light-touch phone normalisation (no country inference — that would need libphonenumber).
 * Accepts 7–15 digits with optional +, spaces, dashes, dots, parentheses.
 */
export function normalizePhone(input: string, opts: { international?: boolean } = {}): NormalizedPhone | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const international = opts.international || trimmed.startsWith('+');
  const display = international ? `+${digits}` : trimmed.replace(/\s+/g, ' ');
  return { display, key: digits };
}
