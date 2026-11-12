"use client";

// mock (publication balance): shared dev's server still counts activations, so the mock keeps a publication balance in
// dollars in this browser and pays reports from it: $12 of $20 that refills every month and $10 that stays, until
// something is spent. The way a report was to be paid when it was signed is kept here too, by report. The real build
// reads the balance from Autumn (the `publication_balance` feature) and keeps the choice on the report; this file and
// every `mock:` line go when it ships.

import { useSyncExternalStore } from "react";
import type { PayWith, BalancePart } from "@/components/reports/payment-choice";

const BALANCE = "mock:publication-balance";
const METHOD = (key: string) => `mock:pay-with:${key}`;
const CHANGED = "mock-publication";
const DAY = 86_400_000;

/** The balance as the mock keeps it: what is left of the monthly part and its size, and what stays until used. */
type Kept = { monthly: [left: number, size: number]; kept: number };
const START: Kept = { monthly: [12, 20], kept: 10 };

function subscribe(heard: () => void) {
  window.addEventListener("storage", heard);
  window.addEventListener(CHANGED, heard);
  return () => {
    window.removeEventListener("storage", heard);
    window.removeEventListener(CHANGED, heard);
  };
}

function useKept(name: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => {
      try {
        return name ? window.localStorage.getItem(name) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
}

const read = (kept: string | null): Kept => {
  try {
    return kept ? (JSON.parse(kept) as Kept) : START;
  } catch {
    return START;
  }
};

/** The first of next month, when the monthly part is back to its size. */
const nextMonth = () => {
  const now = new Date();
  return Math.max(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(), Date.now() + DAY);
};

/** The publication balance this browser keeps, by part, the refilling one first, as Autumn spends them. */
export function useMockBalance(): BalancePart[] {
  const { monthly, kept } = read(useKept(BALANCE));
  return [...(monthly[1] > 0 ? [{ interval: "month" as const, left: monthly[0], size: monthly[1], resetsAt: nextMonth(), refillsTo: monthly[1] }] : []), ...(kept > 0 ? [{ interval: "once" as const, left: kept, size: kept }] : [])];
}

/** Takes `amount` dollars from the balance, the refilling part first. */
export function spendMockBalance(amount: number) {
  try {
    const { monthly, kept } = read(window.localStorage.getItem(BALANCE));
    const fromMonthly = Math.min(monthly[0], amount);
    window.localStorage.setItem(BALANCE, JSON.stringify({ monthly: [monthly[0] - fromMonthly, monthly[1]], kept: Math.max(0, kept - (amount - fromMonthly)) } satisfies Kept));
  } catch {
    // Without storage the balance stays as it started.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Keeps how a report was to be paid when it was signed. */
export function keepMockPayWith(key: string, method: PayWith) {
  try {
    window.localStorage.setItem(METHOD(key), method);
  } catch {
    // Without storage the report opens on the balance, as one signed before the choice existed.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** How the report was to be paid when it was signed in this browser; null for any other. */
export const useMockPayWith = (key: string | null | undefined) => useKept(key ? METHOD(key) : null) as PayWith | null;

/** The part of what is bought that one of dev's two test codes takes off; undefined for any other. */
export const mockCodeOff = (code: string | null | undefined) => (code ? ({ FREEDOI: 1, HALFOFF: 0.5 } as Record<string, number>)[code.trim().toUpperCase()] : undefined);
