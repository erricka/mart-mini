import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import { config } from './config.js';
import { AppError, isCheckViolation } from './lib/errors.js';
import { parseLang, runWithLang, tr } from './lib/i18n.js';
import { adminCatalogRoutes } from './routes/admin/catalog.js';
import { adminCustomerRoutes } from './routes/admin/customers.js';
import { adminInsightRoutes } from './routes/admin/insights.js';
import { adminLoyaltyRoutes } from './routes/admin/loyalty.js';
import { adminOrderRoutes } from './routes/admin/orders.js';
import { customerRoutes } from './routes/customer.js';
import { publicRoutes } from './routes/public.js';
import { cspReportRoutes, telegramRoutes } from './routes/telegram.js';
import { getMedia } from './services/media.js';

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export async function buildApp() {
  const app = Fastify({
    logger: config.isTest ? false : { level: config.LOG_LEVEL },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(helmet, {
    // Telegram Web (web.telegram.org) embeds Mini Apps in an iframe, so X-Frame-Options must be off.
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      // Google Maps hosts follow Google's Maps JavaScript API CSP guide; violations are reported to
      // /api/csp-report (logged) and the map falls back to OpenStreetMap if Google can't load.
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.google.com', "'unsafe-eval'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.google.com', 'https://*.gstatic.com', 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        frameSrc: ["'self'", 'https://*.google.com'],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
        objectSrc: ["'none'"],
        formAction: ["'self'"],
        reportUri: ['/api/csp-report'],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(jwt, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    global: false,
    // Runs after auth guards so signed-in users are limited per account (many mobile users share carrier IPs).
    hook: 'preHandler',
    keyGenerator: (req) => (req.account ? `u:${req.account.id}` : `ip:${req.ip}`),
  });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
  app.decorateRequest('account', null);
  app.decorateRequest('onboarding', null);
  // Every request runs in the language the app asked for (x-lang: km | en).
  app.addHook('onRequest', (req, _reply, done) => {
    runWithLang(parseLang(req.headers['x-lang']) ?? config.DEFAULT_LANGUAGE, done);
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (isCheckViolation(err, 'products_stock_non_negative')) {
      return reply.status(409).send({ error: { code: 'out_of_stock', message: tr('err.out_of_stock') } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'rate_limited', message: tr('err.rate_limited') } });
    }
    if (status < 500) {
      return reply.status(status).send({ error: { code: (err as FastifyError).code ?? 'bad_request', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: tr('err.internal') } });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await api.register(publicRoutes);
      await api.register(telegramRoutes);
      await api.register(cspReportRoutes);
      await api.register(customerRoutes);
      await api.register(
        async (admin) => {
          await admin.register(adminOrderRoutes);
          await admin.register(adminCatalogRoutes);
          await admin.register(adminLoyaltyRoutes);
          await admin.register(adminCustomerRoutes);
          await admin.register(adminInsightRoutes);
        },
        { prefix: '/admin' },
      );
    },
    { prefix: '/api' },
  );

  // Product photos stored in the database.
  app.get('/media/:id', async (req, reply) => {
    const m = await getMedia((req.params as { id: string }).id);
    if (!m) return reply.status(404).send({ error: { code: 'not_found', message: tr('err.not_found') } });
    return reply
      .header('content-type', m.contentType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(m.bytes);
  });

  // Older photos saved on disk (moved into the database on start-up; kept for hosts that still have them).
  await mkdir(config.uploadDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: config.uploadDir,
    prefix: '/uploads/',
    decorateReply: false,
    maxAge: '30d',
    immutable: true,
  });

  const hasWeb = existsSync(resolve(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: false,
      setHeaders(res, path) {
        res.header('cache-control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !hasWeb || req.method !== 'GET') {
      return reply.status(404).send({ error: { code: 'not_found', message: tr('err.not_found') } });
    }
    // SPA fallback: client-side routes like /orders/12 or /admin/products.
    return reply.header('cache-control', 'no-cache').sendFile('index.html', webDist);
  });

  return app;
}
