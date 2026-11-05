import { config } from './config.js';
import { buildApp } from './app.js';
import { pool, waitForDatabase } from './db/client.js';
import { copyDatabaseFrom } from './db/copy.js';
import { runMigrations } from './db/migrate.js';
import { seedStarter } from './db/seed.js';
import { configureBot } from './services/bot.js';
import { importDiskPhotos } from './services/media.js';
import { runMaintenance } from './services/maintenance.js';
import { ensureStoreLocation } from './services/settings.js';
import { dispatchPending, startNotificationWorker } from './services/notifications.js';

// A database that was just resumed (or is still booting) can take a minute to accept connections.
await waitForDatabase();
if (config.MIGRATE_ON_START) await runMigrations();
// Moving to a new database: copy everything from the old one first (only into an empty database).
if (config.COPY_FROM_DATABASE_URL) await copyDatabaseFrom(config.COPY_FROM_DATABASE_URL);
if (config.SEED_ON_START === 'starter') await seedStarter();

const app = await buildApp();
// One-off clean-ups asked for by the owner (once, in one transaction: on error nothing changes and it retries next start).
await runMaintenance(app.log).catch((err) => app.log.error({ err }, 'One-off clean-up failed — nothing was changed'));
const stopWorker = startNotificationWorker(app.log);
// Bot setup talks to Telegram; a problem there must never stop the shop from starting.
const stopBot = await configureBot(app.log).catch((err) => {
  app.log.error({ err }, 'Telegram bot setup failed — the shop is running, the bot chat may not respond');
  return () => {};
});
void dispatchPending();
// Reads the store's Google Maps link into a pin the first time (needs internet; never blocks start-up).
void ensureStoreLocation(app.log);
// Photos uploaded before they were stored in the database (old /uploads disk) → database.
await importDiskPhotos(app.log);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(
  `🛒 API ready on :${config.PORT} — notifications ${config.simulateNotifications ? 'SIMULATED' : 'via Telegram'}, dev login ${config.devLoginEnabled ? 'ON' : 'off'}`,
);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  stopBot();
  stopWorker();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
