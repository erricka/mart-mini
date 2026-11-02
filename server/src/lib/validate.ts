import { z } from 'zod';
import { badRequest } from './errors.js';
import { isKey, tr } from './i18n.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    // Schemas use translation keys as custom messages; anything else gets a generic translated message.
    const message = isKey(first.message) ? tr(first.message) : tr('err.invalid_input', { field: first.path.join('.') || '—' });
    throw badRequest(
      'validation_error',
      message,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
