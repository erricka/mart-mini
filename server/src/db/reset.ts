import { config } from '../config.js';
import { pool } from './client.js';

if (config.isProd) {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}
await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;');
console.log('🧹 Database schema dropped');
await pool.end();
