/**
 * ABA PayWay — PLACEHOLDER (not connected yet).
 *
 * To connect your ABA QR:
 *  1. Set ABA_PAYWAY_MERCHANT_ID, ABA_PAYWAY_API_KEY and ABA_PAYWAY_BASE_URL in .env
 *     (use PayWay's sandbox URL while testing).
 *  2. Implement `createCharge` with ABA's QR/purchase API: send `reference` as the transaction id,
 *     the amount + currency, and `callbackUrl` as the callback/return URL, signed as ABA's docs require.
 *     Return the QR string (and the ABA Mobile deep link if provided).
 *  3. Implement `handleCallback` (route: POST /api/payments/aba_payway/callback): verify ABA's signature /
 *     re-check the transaction status with ABA, then call `confirmQrPayment(orderId, …)`.
 *  4. Return `true` from `isConfigured()` and pick "ABA PayWay" in Dashboard → Settings → Payments.
 *
 * Everything else — reserving stock, the payment screen, sending the order to the shop once paid,
 * expiring unpaid orders, customer/staff notifications — is already wired up.
 */
import type { Charge, CreateChargeInput, QrPaymentProvider } from './types.js';

export const abaPayway: QrPaymentProvider & {
  handleCallback(body: unknown, headers: Record<string, unknown>): Promise<{ orderReference: string; paid: boolean; providerRef?: string }>;
} = {
  id: 'aba_payway',
  label: 'ABA PayWay (KHQR)',

  isConfigured() {
    // TODO(ABA): return Boolean(process.env.ABA_PAYWAY_MERCHANT_ID && process.env.ABA_PAYWAY_API_KEY) once createCharge is implemented.
    return false;
  },

  async createCharge(_input: CreateChargeInput): Promise<Charge> {
    // TODO(ABA): call the ABA PayWay API and return { qrPayload, appLink, providerRef }.
    throw new Error('ABA PayWay is not connected yet.');
  },

  async handleCallback() {
    // TODO(ABA): verify the callback, then return { orderReference: <reference you sent>, paid: true/false }.
    throw new Error('ABA PayWay callback is not implemented yet.');
  },
};
