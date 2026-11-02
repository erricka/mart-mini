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
