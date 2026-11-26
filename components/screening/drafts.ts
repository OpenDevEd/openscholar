"use client";

// What a person has in hand on the screening pages and hasn't saved: changes to a screening's
// settings, a new screening being filled in, and how they left Screen. Kept with the tab, so leaving
// a page and coming back loses nothing, and a reload starts where they were.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Screening } from "./data";

type Kept = {
  /** Unsaved settings by where they are made: a screening's ID, or `new:<the screening it copies>`. */
  drafts: Record<string, Screening>;
  /** The queue's pane on Screen is folded away, to give the paper its width. */
  folded: boolean;
  /** The criteria whose guidance is open on Screen, each as its screening and its key. A reviewer who wants a rule in front of them opens it once, and it stays open from paper to paper. */
  guides: string[];
  /** Each person's pace on Screen: the seconds between their votes, added up, and how many gaps that is. */
  paced: Record<string, { sum: number; n: number }>;
};
type Store = Kept & {
  /** Changes a draft, or drops it when `change` gives nothing back. */
  draft: (key: string, change: (now: Screening | undefined) => Screening | undefined) => void;
  set: (patch: Partial<Kept>) => void;
};

export const useKept = create<Store>()(
  persist(
    (set) => ({
      drafts: {},
      folded: false,
      guides: [],
      paced: {},
      draft: (key, change) =>
        set((state) => {
          const next = change(state.drafts[key]);
          const { [key]: _dropped, ...rest } = state.drafts;
          return { drafts: next ? { ...rest, [key]: next } : rest };
        }),
      set: (patch) => set(patch),
    }),
    { name: "screening:kept:1", storage: createJSONStorage(() => sessionStorage) },
  ),
);
