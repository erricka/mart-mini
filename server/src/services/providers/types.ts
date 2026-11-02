/** Contract every QR payment provider implements. */
export interface CreateChargeInput {
  orderId: number;
  /** Our unique transaction id (e.g. "SM000042") — send it to the provider as its transaction/bill id. */
  reference: string;
  /** Unguessable per-payment token (used by the simulator's links). */
  token: string;
  amountCents: number;
  currency: string;
  expiresAt: Date;
  customer: { firstName: string; lastName: string | null; phone: string };
  /** Where the provider should POST payment results: https://<PUBLIC_URL>/api/payments/<provider>/callback */
  callbackUrl: string;
}

export interface Charge {
  /** QR string to render (e.g. the KHQR string from ABA). */
  qrPayload: string;
  /** Optional deep link into the banking app, e.g. ABA Mobile, for customers on the same phone. */
  appLink?: string | null;
  /** Provider-side id, if any. */
  providerRef?: string | null;
}

export interface QrPaymentProvider {
  id: 'simulated' | 'aba_payway';
  label: string;
  isConfigured(): boolean;
  createCharge(input: CreateChargeInput): Promise<Charge>;
}
