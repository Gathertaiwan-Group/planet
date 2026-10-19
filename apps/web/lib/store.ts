"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PlanetEvent } from "@planet/shared";

export interface CartItem {
  /** b-{planetId}-{plantId} 或 extra sku */
  id: string;
  kind: "baby" | "extra";
  planetId?: number;
  plantId?: number;
  sku?: string;
  name: string;
  sub: string;
  price: number;
  hue: number;
  qty: number;
}

type Step = "cart" | "form" | "done";

interface State {
  // ---- persisted：{ result, cart, regs } + anonId ----
  /** 測驗結果的星球 id（1–12） */
  result: number | null;
  cart: CartItem[];
  /** 已報名的活動 slug */
  regs: string[];
  anonId: string | null;

  // ---- UI ----
  hydrated: boolean;
  cartOpen: boolean;
  step: Step;
  regEvent: PlanetEvent | null;
  seats: Record<string, number>;

  setResult: (id: number) => void;
  addItem: (item: Omit<CartItem, "qty">) => void;
  setQty: (id: string, d: number) => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  setStep: (s: Step) => void;
  openReg: (e: PlanetEvent) => void;
  closeReg: () => void;
  markRegistered: (slug: string, seatsLeft?: number) => void;
  ensureAnonId: () => string;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      result: null,
      cart: [],
      regs: [],
      anonId: null,
      hydrated: false,
      cartOpen: false,
      step: "cart",
      regEvent: null,
      seats: {},

      setResult: (id) => set({ result: id }),
      addItem: (item) =>
        set((s) => {
          const cart = s.cart.slice();
          const i = cart.findIndex((c) => c.id === item.id);
          if (i >= 0) cart[i] = { ...cart[i], qty: Math.min(99, cart[i].qty + 1) };
          else cart.push({ ...item, qty: 1 });
          return { cart };
        }),
      setQty: (id, d) =>
        set((s) => ({ cart: s.cart.map((c) => (c.id === id ? { ...c, qty: Math.min(99, c.qty + d) } : c)).filter((c) => c.qty > 0) })),
      clearCart: () => set({ cart: [] }),
      openCart: () => set({ cartOpen: true, step: "cart" }),
      closeCart: () => set({ cartOpen: false }),
      setStep: (step) => set({ step }),
      openReg: (e) => set({ regEvent: e }),
      closeReg: () => set({ regEvent: null }),
      markRegistered: (slug, seatsLeft) =>
        set((s) => ({
          regs: s.regs.includes(slug) ? s.regs : s.regs.concat(slug),
          seats: seatsLeft === undefined ? s.seats : { ...s.seats, [slug]: seatsLeft },
        })),
      ensureAnonId: () => {
        const cur = get().anonId;
        if (cur) return cur;
        const id = newId();
        set({ anonId: id });
        return id;
      },
    }),
    {
      name: "twelve-planets-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ result: s.result, cart: s.cart, regs: s.regs, anonId: s.anonId }),
      skipHydration: true,
      onRehydrateStorage: () => () => {
        useStore.setState({ hydrated: true });
      },
    },
  ),
);

export const cartCount = (cart: CartItem[]) => cart.reduce((n, c) => n + c.qty, 0);
export const cartTotal = (cart: CartItem[]) => cart.reduce((n, c) => n + c.price * c.qty, 0);
