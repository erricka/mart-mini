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
