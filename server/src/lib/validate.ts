import { z } from 'zod';
import { badRequest } from './errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(
      'validation_error',
      first.message.startsWith('Invalid') ? `${field}${first.message}` : first.message,
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });
