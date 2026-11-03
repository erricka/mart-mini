import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';
import { handleUpdate, type TgUpdate } from '../services/bot.js';

export async function telegramRoutes(app: FastifyInstance) {
  app.post('/telegram/webhook', async (req, reply) => {
    const given = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] ?? ''));
    const expected = Buffer.from(config.webhookSecret);
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden();
    // Acknowledge fast; Telegram retries on slow/failed responses.
    void handleUpdate(req.body as TgUpdate, req.log);
    return reply.send({ ok: true });
  });
}

/**
 * Browsers POST Content-Security-Policy violations here (see app.ts). Logged so a blocked
 * third-party resource (e.g. a Google Maps host) shows up in the server logs.
 */
export async function cspReportRoutes(app: FastifyInstance) {
  for (const type of ['application/csp-report', 'application/reports+json']) {
    app.addContentTypeParser(type, { parseAs: 'string', bodyLimit: 20_000 }, (_req, body, done) => {
      try {
        done(null, JSON.parse(String(body)));
      } catch {
        done(null, {});
      }
    });
  }
  app.post('/csp-report', { bodyLimit: 20_000, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.body as Record<string, any> | Record<string, any>[] | null;
    const reports = Array.isArray(raw) ? raw.map((r) => r?.body ?? r) : [raw?.['csp-report'] ?? raw];
    for (const r of reports.slice(0, 5)) {
      if (!r) continue;
      req.log.warn(
        {
          blocked: String(r['blocked-uri'] ?? r.blockedURL ?? '').slice(0, 300),
          directive: String(r['violated-directive'] ?? r.effectiveDirective ?? '').slice(0, 100),
          page: String(r['document-uri'] ?? r.documentURL ?? '').slice(0, 200),
        },
        'CSP violation',
      );
    }
    return reply.status(204).send();
  });
}
