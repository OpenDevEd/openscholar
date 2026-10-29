"use client";

// Mock (mock/ai-overview): lenses kept in this browser. The real feature keeps them in Convex,
// per person, with a workspace share, through registered user actions.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Lens = { id: string; name: string; instruction: string; shared: boolean; mine: boolean };

export const DEFAULT_LENS: Lens = { id: "overview", name: "Overview", instruction: "What this research covers, how much of it there is, and where to start reading.", shared: false, mine: true };

const SEEDED: Lens[] = [
  DEFAULT_LENS,
  { id: "trend", name: "Year by year", instruction: "How output changes from year to year: growth, dips, and the years that stand out.", shared: false, mine: true },
  { id: "where", name: "Where it comes from", instruction: "Which countries the authors work in, and how concentrated the field is.", shared: true, mine: false },
  { id: "read", name: "What to read first", instruction: "The most cited papers and the newest ones worth knowing.", shared: true, mine: true },
];

/** Overviews a person on Go or above gets free each day before their credits are used. */
export const DAILY_CAP = 25;
/** Pro's daily free overviews, named where Go's run out. */
export const PRO_CAP = 100;

type State = {
  lenses: Lens[];
  open: string;
  collapsed: boolean;
  usedToday: number;
  /** Mock only: shows the free plan, where an overview waits for Generate. */
  freePlan: boolean;
  setFreePlan: (freePlan: boolean) => void;
  /** Mock only: the workspace has no credits left. */
  noCredits: boolean;
  setNoCredits: (noCredits: boolean) => void;
  /** Mock only: uses up today's free overviews, or gives them back. */
  setUsedToday: (usedToday: number) => void;
  pick: (id: string) => void;
  save: (lens: Omit<Lens, "id" | "mine"> & { id?: string }) => void;
  remove: (id: string) => void;
  toggle: () => void;
  spend: () => void;
};

export const useLenses = create<State>()(
  persist(
    (set) => ({
      lenses: SEEDED,
      open: DEFAULT_LENS.id,
      collapsed: false,
      usedToday: 9,
      freePlan: false,
      setFreePlan: (freePlan) => set({ freePlan }),
      noCredits: false,
      setNoCredits: (noCredits) => set({ noCredits }),
      setUsedToday: (usedToday) => set({ usedToday }),
      pick: (open) => set({ open }),
      save: ({ id, ...lens }) =>
        set((state) => {
          if (id) return { lenses: state.lenses.map((l) => (l.id === id ? { ...l, ...lens } : l)) };
          const made = { ...lens, id: crypto.randomUUID(), mine: true };
          return { lenses: [...state.lenses, made], open: made.id };
        }),
      remove: (id) => set((state) => ({ lenses: state.lenses.filter((l) => l.id !== id), open: state.open === id ? DEFAULT_LENS.id : state.open })),
      toggle: () => set((state) => ({ collapsed: !state.collapsed })),
      spend: () => set((state) => ({ usedToday: Math.min(DAILY_CAP, state.usedToday + 1) })),
    }),
    { name: "mock-ai-overview-lenses" },
  ),
);
