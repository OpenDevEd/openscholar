"use client";

// What a person has in hand on the screening pages and hasn't saved: changes to a screening's
// settings, a new screening being filled in, and how they left Screen. Kept with the tab, so leaving
// a page and coming back loses nothing, and a reload starts where they were.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Answer } from "@/lib/screening/rules";
import type { Reviewer, Screening } from "./data";
import type { DiscussionDraft } from "./discussion";

/** What is written on a paper and not sent yet, by paper: answers before the vote, a note, a message to the others. Kept here, not in the page, so going to another tab of the screening and back loses none of it. */
type InHand = {
  answers: Record<string, Record<string, Answer>>;
  notes: Record<string, string>;
  talks: Record<string, DiscussionDraft>;
  /** The Papers drawer's notes, on a vote and on a settled result. */
  paperNotes: Record<string, Partial<Record<"vote" | "result", string>>>;
  paperTalks: Record<string, DiscussionDraft>;
};

type Kept = {
  /** Unsaved settings by where they are made: a screening's ID, or `new:<the screening it copies>`. */
  drafts: Record<string, Screening>;
  /** The screening the server made to read a new screening's sources before it starts, by the same key (convex/screening/screenings.ts `sync`). */
  reads: Record<string, string>;
  /** The queue's pane on Screen is folded away, to give the paper its width. */
  folded: boolean;
  /** The criteria whose guidance is open on Screen, each as its screening and its key. A reviewer who wants a rule in front of them opens it once, and it stays open from paper to paper. */
  guides: string[];
  /** Each person's pace on Screen: the seconds between their votes, added up, and how many gaps that is. */
  paced: Record<string, { sum: number; n: number }>;
  /** Who was last picked to be added, and asked about: Forward or a reload over the question asks about them again. */
  adding?: Reviewer;
  inHand: InHand;
};
type Store = Kept & {
  /** Changes a draft, or drops it when `change` gives nothing back. */
  draft: (key: string, change: (now: Screening | undefined) => Screening | undefined) => void;
  set: (patch: Partial<Kept>) => void;
};

/** What a new screening's draft key says (./screening-form.tsx `key`): the workspace it was begun in, whose it is, and what it was begun from. */
export const draftOf = (key: string) => {
  const [kind, workspace, who, from, search, handoff] = key.split(":");
  return kind === "new" ? { workspace: workspace ?? "", who: who ?? "", started: { ...(from ? { from } : {}), ...(search ? { search } : {}), ...(handoff ? { handoff } : {}) } } : null;
};

export const useKept = create<Store>()(
  persist(
    (set) => ({
      drafts: {},
      reads: {},
      folded: false,
      guides: [],
      paced: {},
      inHand: { answers: {}, notes: {}, talks: {}, paperNotes: {}, paperTalks: {} },
      draft: (key, change) =>
        set((state) => {
          const next = change(state.drafts[key]);
          const { [key]: _dropped, ...rest } = state.drafts;
          return { drafts: next ? { ...rest, [key]: next } : rest };
        }),
      set: (patch) => set(patch),
    }),
    { name: "screening:kept:2", storage: createJSONStorage(() => sessionStorage) },
  ),
);

/** One kind of what is in hand, read and changed as a page's own state would be. */
export function useInHand<K extends keyof InHand>(key: K) {
  const value = useKept((kept) => kept.inHand[key]);
  const set = (next: InHand[K] | ((now: InHand[K]) => InHand[K])) =>
    useKept.setState((state) => ({ inHand: { ...state.inHand, [key]: typeof next === "function" ? (next as (now: InHand[K]) => InHand[K])(state.inHand[key]) : next } }));
  return [value, set] as const;
}
