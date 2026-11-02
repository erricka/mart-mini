import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://market:market@localhost:5432/market_test',
      SESSION_SECRET: 'test-secret-test-secret-test-secret-123456',
      TELEGRAM_BOT_TOKEN: '123456:TEST_BOT_TOKEN_for_signature_checks',
      TELEGRAM_BOT_MODE: 'off',
      NOTIFICATIONS_MODE: 'simulate',
      DEV_LOGIN_ENABLED: 'false',
      ADMIN_TELEGRAM_IDS: '999000001',
      LOG_LEVEL: 'silent',
    },
  },
});
