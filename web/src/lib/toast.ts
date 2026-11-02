import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone: 'success' | 'error' | 'info';
}

interface ToastState {
  toasts: Toast[];
  push(text: string, tone?: Toast['tone']): void;
  dismiss(id: number): void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(text, tone = 'info') {
    const id = ++seq;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 5000 : 3000);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = (text: string, tone?: Toast['tone']) => useToasts.getState().push(text, tone);
