import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
/** Anything that can run queries: the db itself or an open transaction. */
export type Executor = DB | Tx;

/**
 * Waits until PostgreSQL accepts connections (e.g. a database that was just resumed or is still
 * starting next to the app). Retries for up to `timeoutMs`, then gives up with the last error.
 */
export async function waitForDatabase(timeoutMs = 120_000, log: (msg: string) => void = console.log) {
  const deadline = Date.now() + timeoutMs;
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      if (attempt > 1) log('✅ Database is ready.');
      return;
    } catch (err) {
      if (Date.now() + delay > deadline) throw err;
      if (attempt === 1) log(`⏳ Waiting for the database to accept connections (${(err as Error).message})…`);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  }
}
