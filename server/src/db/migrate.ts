import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

// Run directly: `npm run db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runMigrations()
    .then(() => console.log('✅ Migrations applied'))
    .catch((err) => {
      console.error('❌ Migration failed', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
