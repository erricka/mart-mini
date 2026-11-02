import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import type { Level } from '../../lib/types';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const useIsAdmin = () => useSession().user?.role === 'admin';

export interface Settings {
  shopName: string;
  tagline: string;
  currency: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFeeCents: number;
  freeDeliveryMinCents: number | null;
  minOrderCents: number;
  pickupAddress: string;
  pickupHours: string;
  supportPhone: string;
  pointsPerDollar: number;
  signupBonusPoints: number;
  welcomeCouponId: number | null;
  rewardExpiryDays: number | null;
  cashEnabled: boolean;
  qrPaymentMode: 'off' | 'simulated' | 'aba_payway';
  qrPaymentInstructions: string;
  paymentWindowMinutes: number;
}

export interface AdminCoupon {
  id: number;
  code: string | null;
  title: string;
  description: string;
  discountType: 'percent' | 'fixed' | 'free_delivery' | 'free_product';
  value: number;
  freeProductId: number | null;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  perCustomerLimit: number | null;
  isPublic: boolean;
  active: boolean;
  benefit: string;
  isWelcome: boolean;
}

export interface AdminReward {
  id: number;
  title: string;
  description: string;
  emoji: string;
  pointsRequired: number;
  isSurprise: boolean;
  active: boolean;
  benefit: { discountType: AdminCoupon['discountType']; value: number; freeProductId: number | null; minSubtotalCents: number; maxDiscountCents: number | null; label: string };
}

export interface LoyaltyData {
  settings: Settings & { id: number; updatedAt: string };
  paymentProviders: { id: string; label: string; configured: boolean }[];
  levels: Level[];
  rewards: AdminReward[];
  coupons: AdminCoupon[];
  stats: { unlocked: number; used: number };
}

export const useLoyalty = () => useQuery({ queryKey: ['admin', 'loyalty'], queryFn: () => api<LoyaltyData>('/admin/loyalty') });

export function settingsPayload(s: LoyaltyData['settings'], patch: Partial<Settings>): Settings {
  const { id: _id, updatedAt: _u, ...rest } = s;
  return { ...rest, ...patch };
}

export const Th = ({ children, className = '' }: { children?: ReactNode; className?: string }) => (
  <th className={`px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted ${className}`}>{children}</th>
);
export const Td = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <td className={`px-3 py-3 align-middle ${className}`}>{children}</td>;
