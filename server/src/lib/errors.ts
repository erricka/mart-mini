import { tr } from './i18n.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = tr('err.sign_in')) => new AppError(401, 'unauthorized', message);
export const forbidden = (message = tr('err.forbidden')) => new AppError(403, 'forbidden', message);
export const notFound = (message = tr('err.not_found')) => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

/** Postgres unique_violation (23505), unwrapping Drizzle's error wrapper. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: any = err;
  for (let i = 0; i < 4 && e; i++) {
    if (e.code === '23505' && (!constraint || e.constraint === constraint)) return true;
    e = e.cause;
  }
  return false;
}

/** Postgres check_violation (23514). */
export function isCheckViolation(err: unknown, constraint?: string): boolean {
  let e: any = err;
  for (let i = 0; i < 4 && e; i++) {
    if (e.code === '23514' && (!constraint || e.constraint === constraint)) return true;
    e = e.cause;
  }
  return false;
}
