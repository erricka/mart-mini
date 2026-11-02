import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Product } from './types';

export interface CartLine {
  productId: number;
  quantity: number;
  name: string;
  unit: string;
  emoji: string;
  imageUrl: string | null;
  priceCents: number;
  stock: number;
}

interface CartState {
  ownerId: number | null;
  lines: CartLine[];
  bump: number;
  ensureOwner(id: number): void;
  add(p: Product, qty?: number): void;
  setQty(productId: number, qty: number): void;
  remove(productId: number): void;
  clear(): void;
  syncStock(updates: { productId: number; available: number }[]): void;
}

const MAX = 99;

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ownerId: null,
      lines: [],
      bump: 0,
      ensureOwner(id) {
        if (get().ownerId !== id) set({ ownerId: id, lines: [] });
      },
      add(p, qty = 1) {
        const lines = [...get().lines];
        const i = lines.findIndex((l) => l.productId === p.id);
        const limit = Math.min(MAX, p.stock);
        if (i >= 0) lines[i] = { ...lines[i], quantity: Math.min(limit, lines[i].quantity + qty), stock: p.stock, priceCents: p.priceCents };
        else
          lines.push({
            productId: p.id,
            quantity: Math.min(limit, qty),
            name: p.name,
            unit: p.unit,
            emoji: p.emoji,
            imageUrl: p.imageUrl,
            priceCents: p.priceCents,
            stock: p.stock,
          });
        set({ lines, bump: get().bump + 1 });
      },
      setQty(productId, qty) {
        if (qty <= 0) return get().remove(productId);
        set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(qty, MAX, Math.max(l.stock, 1)) } : l)) });
      },
      remove(productId) {
        set({ lines: get().lines.filter((l) => l.productId !== productId) });
      },
      clear() {
        set({ lines: [] });
      },
      syncStock(updates) {
        const by = new Map(updates.map((u) => [u.productId, u.available]));
        set({ lines: get().lines.map((l) => (by.has(l.productId) ? { ...l, stock: by.get(l.productId)! } : l)) });
      },
    }),
    { name: 'sm-cart-v1', partialize: (s) => ({ ownerId: s.ownerId, lines: s.lines }) },
  ),
);

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity, 0);
export const cartSubtotal = (lines: CartLine[]) => lines.reduce((n, l) => n + l.quantity * l.priceCents, 0);
