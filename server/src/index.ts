import { config } from './config.js';
import { buildApp } from './app.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedStarter } from './db/seed.js';
import { configureBot } from './services/bot.js';
import { dispatchPending, startNotificationWorker } from './services/notifications.js';

if (config.MIGRATE_ON_START) await runMigrations();
if (config.SEED_ON_START === 'starter') await seedStarter();

const app = await buildApp();
const stopWorker = startNotificationWorker(app.log);
const stopBot = await configureBot(app.log);
void dispatchPending();

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
