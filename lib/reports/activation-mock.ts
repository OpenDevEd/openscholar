"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// MOCK (mock/activation-payment): paying to activate a report. Nothing here reaches Autumn or Stripe. The real build
// reads the workspace's saved card from Autumn (`customers.get_or_create` with `payment_method`), saves one through
// Autumn's `billing.setup_payment` (Stripe Checkout in setup mode), and charges an activation by attaching a one-off
// "report_activation" plan with `billing.attach`, keyed to the report. The free activations a workspace has left today
// come from the admin's daily number, which counts activations instead of starts. This tab's session storage keeps
// the mock's answers, so a reload keeps the state being looked at.

/** What one activation costs past the free ones, in US dollars. The real price is the Autumn plan's. */
export const ACTIVATION_PRICE = 5;

export type MockCard = "none" | "saved" | "declines";

type Store = {
  /** The person's role in an organisation's workspace, in place of their real one; null is the real one. A person's own
   * workspace is always theirs to activate in. */
  role: "admin" | "member" | null;
  /** The workspace's saved card: none, one that pays, or one the bank declines. */
  card: MockCard;
  /** Free activations the workspace has left today. */
  freeLeft: number;
  /** The plan's new reports for today are used up. */
  startsUsed: boolean;
  /** The admin's free activations a day, for a person's own workspace and an organisation's. The real ones are the settings'
   * `perDay` and `orgPerDay`, which count starts until the build moves them to activations. */
  freePerDay: { personal: number; organization: number };
  set: (patch: Partial<Pick<Store, "role" | "card" | "freeLeft" | "startsUsed" | "freePerDay">>) => void;
  /** An activation went through: a free one comes off the day's. */
  activated: (free: boolean) => void;
};

export const useActivationMock = create<Store>()(
  persist(
    (set) => ({
      role: null,
      card: "none",
      freeLeft: 0,
      startsUsed: false,
      freePerDay: { personal: 0, organization: 0 },
      set: (patch) => set(patch),
      activated: (free) => set((s) => (free ? { freeLeft: Math.max(0, s.freeLeft - 1) } : {})),
    }),
    { name: "mock-activation-payment", storage: createJSONStorage(() => sessionStorage) },
  ),
);

/**
 * The promo codes the mock knows, by the share of the price they take off. The real ones are Autumn rewards with
 * promotion codes: the charge passes `discounts: [{ promotion_code }]` to `billing.attach`, and the dialog's total is
 * Autumn's `billing.preview_attach` with the same code.
 */
export const MOCK_CODES: Record<string, number> = { FREEDOI: 100, HALFOFF: 50 };

/** The card the mock saves, as Autumn would report it. */
export const MOCK_CARD = { brand: "visa", last4: "4242" };

/** How long the mock waits where the real page waits on Stripe or Autumn. */
export const mockWait = (ms = 900) => new Promise<void>((resolve) => setTimeout(resolve, ms));
