/**
 * What the customer has entered at checkout (address, pin, speed, contact, note, discount), kept for
 * the browser session — going back to the basket or retrying never loses it. Cleared after an order.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DeliverySpeed, LatLng } from './types';

export type Discount = { kind: 'reward'; id: number } | { kind: 'code'; code: string } | null;
export interface NewAddress {
  line1: string;
  line2: string;
  city: string;
  instructions: string;
}

export interface CheckoutDraft {
  ownerId: number | null;
  fulfillment: 'delivery' | 'pickup';
  addressId: number | null;
  addingAddress: boolean;
  newAddress: NewAddress;
  pin: LatLng | null;
  speed: DeliverySpeed;
  contactName: string;
  contactPhone: string;
  note: string;
  discount: Discount;
  filledFromMap: boolean;
  movedToNew: boolean;
}

const EMPTY_ADDRESS: NewAddress = { line1: '', line2: '', city: '', instructions: '' };
const fresh = (ownerId: number | null, contactName = '', contactPhone = ''): CheckoutDraft => ({
  ownerId,
  fulfillment: 'delivery',
  addressId: null,
  addingAddress: false,
  newAddress: EMPTY_ADDRESS,
  pin: null,
  speed: 'same_day',
  contactName,
  contactPhone,
  note: '',
  discount: null,
  filledFromMap: false,
  movedToNew: false,
});

interface Store extends CheckoutDraft {
  set(patch: Partial<CheckoutDraft>): void;
  /** Start a clean draft when a different customer opens checkout on this device. */
  ensureOwner(id: number, contactName: string, contactPhone: string): void;
  reset(): void;
}

export const useCheckoutDraft = create<Store>()(
  persist(
    (set, get) => ({
      ...fresh(null),
      set: (patch) => set(patch),
      ensureOwner: (id, contactName, contactPhone) => {
        if (get().ownerId !== id) set(fresh(id, contactName, contactPhone));
      },
      reset: () => set(fresh(get().ownerId)),
    }),
    { name: 'sm-checkout-draft-v1', storage: createJSONStorage(() => sessionStorage) },
  ),
);

export { EMPTY_ADDRESS };
