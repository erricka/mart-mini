import { Bike, CircleCheck, CircleX, PackageCheck, ReceiptText, ShoppingBasket, Store, type LucideIcon } from 'lucide-react';
import type { OrderStatus, PaymentStatus } from './types';

/** Icon (+ emoji for staff screens) and colour per status; labels come from translations (status.* / blurb.*). */
export const STATUS_META: Record<OrderStatus, { emoji: string; icon: LucideIcon; tone: string }> = {
  placed: { emoji: '🧾', icon: ReceiptText, tone: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300' },
  confirmed: { emoji: '✅', icon: CircleCheck, tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  preparing: { emoji: '🧺', icon: ShoppingBasket, tone: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  out_for_delivery: { emoji: '🚚', icon: Bike, tone: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  delivered: { emoji: '📦', icon: PackageCheck, tone: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  ready_for_pickup: { emoji: '🛍️', icon: Store, tone: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300' },
  collected: { emoji: '🎉', icon: PackageCheck, tone: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  cancelled: { emoji: '❌', icon: CircleX, tone: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' },
};

export const PAYMENT_TONE: Record<PaymentStatus, string> = {
  unpaid: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  refunded: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
};

export const isActive = (s: OrderStatus) => !['delivered', 'collected', 'cancelled'].includes(s);
