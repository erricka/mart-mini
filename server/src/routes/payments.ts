/** Public payment endpoints reached by scanning a QR (no session). Tokens are unguessable and single-order. */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { db } from '../db/client.js';
import { orders, payments } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { formatMoney, orderCode } from '../lib/format.js';
import { limit } from '../lib/rate-limit.js';
import { confirmQrPayment, simulatePaymentByToken } from '../services/payments.js';
import { abaPayway } from '../services/providers/aba-payway.js';
import { getSettings } from '../services/settings.js';

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f7f2;color:#12201a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
.card{background:#fff;border-radius:24px;padding:28px;max-width:380px;width:100%;box-shadow:0 10px 30px #0001;text-align:center}
.tag{display:inline-block;background:#fef3c7;color:#92400e;font-weight:700;font-size:12px;letter-spacing:.06em;padding:6px 10px;border-radius:999px}
h1{font-size:22px;margin:14px 0 4px}.amt{font-size:40px;font-weight:800;margin:10px 0}p{color:#5f6f68}
button{width:100%;border:0;border-radius:16px;padding:16px;font-size:17px;font-weight:700;background:#16a34a;color:#fff;margin-top:14px}</style></head>
<body><div class="card">${body}</div></body></html>`;

export async function paymentRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  async function loadByToken(token: string) {
    if (!TOKEN.test(token)) throw notFound();
    const [row] = await db
      .select({ payment: payments, order: orders })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.checkoutToken, token));
    if (!row) throw notFound('Payment session not found.');
    return row;
  }

  // QR image for the payment screen / Telegram downloadFile. Only while the order is awaiting payment.
  app.get('/payments/qr/:file', { config: limit(120) }, async (req, reply) => {
    const token = String((req.params as { file: string }).file).replace(/\.png$/, '');
    const { payment, order } = await loadByToken(token);
    if (order.status !== 'awaiting_payment' || !payment.qrPayload) throw notFound('This payment QR is no longer active.');
    const png = await QRCode.toBuffer(payment.qrPayload, { width: 720, margin: 2, errorCorrectionLevel: 'M' });
    return reply.type('image/png').header('cache-control', 'no-store').send(png);
  });

  // SIMULATED payment page — what a phone camera opens when scanning a demo QR. No money moves.
  app.get('/payments/simulate/:token', { config: limit(60) }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const { payment, order } = await loadByToken(token);
    const settings = await getSettings();
    reply.type('text/html');
    if (payment.status === 'paid') return page('Paid', `<span class="tag">SIMULATED PAYMENT</span><h1>✅ Already paid</h1><p>Order ${orderCode(order.id)} has been paid.</p>`);
    if (order.status !== 'awaiting_payment') return page('Closed', `<span class="tag">SIMULATED PAYMENT</span><h1>Payment closed</h1><p>This order is ${order.status.replace(/_/g, ' ')}.</p>`);
    return page(
      'Simulated payment',
      `<span class="tag">SIMULATED PAYMENT · DEMO ONLY</span><h1>${settings.shopName}</h1><p>Order ${orderCode(order.id)} · ref ${payment.reference}</p>
       <div class="amt">${formatMoney(order.totalCents, settings.currency)}</div>
       <form method="post"><button type="submit">Simulate successful payment</button></form>
       <p style="font-size:13px;margin-top:16px">This stands in for a real banking app or payment provider. No money is charged.</p>`,
    );
  });

  // ABA PayWay callback — PLACEHOLDER until services/providers/aba-payway.ts is implemented.
  app.post('/payments/aba_payway/callback', { config: limit(120) }, async (req, reply) => {
    if (!abaPayway.isConfigured()) return reply.status(501).send({ error: { code: 'not_implemented', message: 'ABA PayWay is not connected yet.' } });
    const result = await abaPayway.handleCallback(req.body, req.headers);
    const [p] = await db.select().from(payments).where(eq(payments.reference, result.orderReference));
    if (!p) throw notFound('Unknown transaction.');
    if (result.paid) await confirmQrPayment(p.orderId, { note: 'Paid via ABA PayWay', providerRef: result.providerRef });
    return { ok: true };
  });

  app.post('/payments/simulate/:token', { config: limit(30) }, async (req, reply) => {
    const { token } = req.params as { token: string };
    if (!TOKEN.test(token)) throw notFound();
    reply.type('text/html');
    try {
      const orderId = await simulatePaymentByToken(token);
      return page('Paid', `<span class="tag">SIMULATED PAYMENT</span><h1>✅ Payment successful</h1><p>Order ${orderCode(orderId)} is now on its way to the shop. You can go back to Telegram.</p>`);
    } catch (err) {
      const msg = err instanceof AppError ? err.message : 'Something went wrong.';
      return reply.status(err instanceof AppError ? err.statusCode : 500).send(page('Payment failed', `<h1>⚠️ ${msg}</h1>`));
    }
  });
}
