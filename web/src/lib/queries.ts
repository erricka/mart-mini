import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { setCurrency } from './format';
import { isActive } from './status';
import type { Address, Category, OrderDetail, OrderSummary, Product, Progress, RewardsOverview, Shop, User, WalletItem, Level } from './types';

export function useShop() {
  return useQuery({
    queryKey: ['shop'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const s = await api<Shop>('/shop');
      setCurrency(s.currency);
      return s;
    },
  });
}

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], staleTime: 5 * 60_000, queryFn: () => api<{ categories: Category[] }>('/categories').then((r) => r.categories) });

export function useProducts(params: { categoryId?: number; q?: string; promo?: boolean; featured?: boolean; limit?: number }) {
  const qs = new URLSearchParams();
  if (params.categoryId) qs.set('categoryId', String(params.categoryId));
  if (params.q) qs.set('q', params.q);
  if (params.promo) qs.set('promo', '1');
  if (params.featured) qs.set('featured', '1');
  if (params.limit) qs.set('limit', String(params.limit));
  return useQuery({
    queryKey: ['products', params],
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => api<{ products: Product[] }>(`/products?${qs}`).then((r) => r.products),
  });
}

export const useProduct = (id: number) =>
  useQuery({ queryKey: ['product', id], queryFn: () => api<{ product: Product; category: Pick<Category, 'id' | 'name' | 'emoji' | 'color'> | null }>(`/products/${id}`) });

export interface HomeData {
  user: User;
  balance: number;
  level: Level;
  progress: Progress | null;
  unseen: WalletItem[];
  availableRewards: number;
  activeOrders: number;
  awaitingPaymentOrderId: number | null;
}
export const useHome = () => useQuery({ queryKey: ['home'], queryFn: () => api<HomeData>('/home') });
export const useRewards = () => useQuery({ queryKey: ['rewards'], queryFn: () => api<RewardsOverview>('/rewards') });
export const useOrders = () => useQuery({ queryKey: ['orders'], queryFn: () => api<{ orders: OrderSummary[]; activeCount: number }>('/orders') });
export const useOrder = (id: number) =>
  useQuery({
    queryKey: ['order', id],
    queryFn: () => api<{ order: OrderDetail }>(`/orders/${id}`).then((r) => r.order),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? 15_000 : false),
  });
export const useAddresses = () => useQuery({ queryKey: ['addresses'], queryFn: () => api<{ addresses: Address[] }>('/me/addresses').then((r) => r.addresses) });
