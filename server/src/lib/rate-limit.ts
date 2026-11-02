import { config } from '../config.js';

/** Per-route rate limit. Keys by account when signed in (see app.ts), by IP otherwise. Relaxed in tests. */
export const limit = (max: number, timeWindow = '1 minute') => ({
  rateLimit: { max: config.isTest ? 100_000 : max, timeWindow },
});
