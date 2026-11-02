import type { OrderStatus, PaymentMethod, PaymentStatus } from './types';

export const STATUS_META: Record<OrderStatus, { label: string; emoji: string; tone: string; blurb: string }> = {
  awaiting_payment: { label: 'Awaiting payment', emoji: '📱', tone: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300', blurb: 'Pay by QR to send your order to the shop.' },
  placed: { label: 'Placed', emoji: '🧾', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300', blurb: 'The shop has your order and will confirm it shortly.' },
  confirmed: { label: 'Confirmed', emoji: '✅', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300', blurb: 'Your order is confirmed.' },
  preparing: { label: 'Preparing', emoji: '🧺', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300', blurb: 'We are picking and packing your groceries.' },
  out_for_delivery: { label: 'Out for delivery', emoji: '🚚', tone: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300', blurb: 'Your order is on its way!' },
  delivered: { label: 'Delivered', emoji: '📦', tone: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300', blurb: 'Delivered. Enjoy your groceries!' },
  ready_for_pickup: { label: 'Ready for pickup', emoji: '🛍️', tone: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300', blurb: 'Your order is ready — come and collect it.' },
  collected: { label: 'Collected', emoji: '🎉', tone: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300', blurb: 'Collected. Thanks for shopping with us!' },
  cancelled: { label: 'Cancelled', emoji: '❌', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300', blurb: 'This order was cancelled.' },
};

export const PAYMENT_META: Record<PaymentStatus, { label: string; tone: string }> = {
  unpaid: { label: 'Unpaid', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' },
  paid: { label: 'Paid', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  refunded: { label: 'Refunded', tone: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  failed: { label: 'Failed', tone: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' },
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash on delivery / at pickup',
  qr: 'QR payment',
};

export const isActive = (s: OrderStatus) => !['delivered', 'collected', 'cancelled'].includes(s);
