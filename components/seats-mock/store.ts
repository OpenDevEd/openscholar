"use client";

// The Team seats mock (#862, #863, #40): what Autumn's Licenses would hold for each organization,
// kept in this browser tab until the build. Every page around it is the real one, with real members
// and invitations; only the seats, the held ones and a failed payment are the mock's.

import { useSyncExternalStore } from "react";
import { useNow } from "next-intl";
import { TEAM_PLAN } from "@/lib/billing/plans";

export type SeatsMock = {
  /** On Team in the mock. */
  team: boolean;
  /** Seats bought. */
  seats: number;
  /** Seats of members removed after spending credits this month: taken until the renewal. */
  held: number;
  /** The last payment failed. */
  failed: boolean;
  /** When Team renews, in ms. */
  renewsAt: number;
  /** Team ends at the renewal, and the organization moves to Free. */
  toFree: boolean;
  /** Members removed in the mock, which the members list leaves out. */
  removed: string[];
};

const KEY = "openscholar.seats-mock";
const EMPTY: Record<string, SeatsMock> = {};
const listeners = new Set<() => void>();
let state: Record<string, SeatsMock> | null = null;

function read(): Record<string, SeatsMock> {
  if (state) return state;
  try {
    state = JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, SeatsMock>;
  } catch {
    state = {};
  }
  return state;
}

function write(next: Record<string, SeatsMock>) {
  state = next;
  sessionStorage.setItem(KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** A month after `at`, as Stripe counts a monthly period. */
export const monthAfter = (at: number) => {
  const date = new Date(at);
  date.setMonth(date.getMonth() + 1);
  return date.getTime();
};

/**
 * The organization's seats in the mock, from what `seed` gives (its real plan, members and
 * invitations) until something is changed. Undefined until `seed` can say.
 */
export function useSeatsMock(workspaceId: string | undefined, seed: SeatsMock | undefined) {
  const all = useSyncExternalStore(subscribe, read, () => EMPTY);
  const value = (workspaceId && all[workspaceId]) || seed;
  const set = (patch: Partial<SeatsMock>) => {
    if (workspaceId && value) write({ ...read(), [workspaceId]: { ...value, ...patch } });
  };
  const reset = () => {
    if (!workspaceId) return;
    const { [workspaceId]: _gone, ...rest } = read();
    write(rest);
  };
  return { mock: value, set, reset };
}

/**
 * What changing the seat count from `from` to `to` costs, as Autumn's preview gives it: an added seat
 * pays for the days left until the renewal, a removed one comes off the next bill for its unused days.
 */
export function seatChange({ price, from, to, renewsAt, now }: { price: number; from: number; to: number; renewsAt: number; now: number }) {
  const start = new Date(renewsAt);
  start.setMonth(start.getMonth() - 1);
  const share = Math.min(1, Math.max(0, (renewsAt - now) / (renewsAt - start.getTime())));
  const amount = Math.round((to - from) * price * share * 100) / 100;
  return { amount, monthly: to * price };
}

/**
 * An organization's seats in the mock, seeded from what the page reads of it: its plan, its members
 * and invitations (one seat each, as the move to bought seats gives them) and when its plan renews.
 */
export function useOrganizationSeats(
  workspaceId: string | undefined,
  organization: { plan?: string } | undefined,
  counts: { members: number; invitations: number } | null | undefined,
  renewsAt: number | undefined,
) {
  const now = useNow({ updateInterval: 60_000 }).getTime();
  const seed: SeatsMock | undefined =
    organization && counts
      ? { team: organization.plan === TEAM_PLAN, seats: Math.max(1, counts.members + counts.invitations), held: 0, failed: false, renewsAt: renewsAt ?? monthAfter(now), toFree: false, removed: [] }
      : undefined;
  return { ...useSeatsMock(workspaceId, seed), now };
}
