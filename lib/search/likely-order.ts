"use client";

import { create } from "zustand";

/** A rating this high says "more like this"; this low says "less like this". */
export const LIKED_RATING = 4;
export const DISLIKED_RATING = 2;
/** The most papers the API takes on each side. */
export const MOST_SEEDS = 100;

/** Each search's results in their likely order, by paper ID, with what the order was made from. Lasts for the page's life. */
export const useLikelyOrder = create<{ orders: Record<string, { ids: string[]; ratings: string }>; set: (searchId: string, order: { ids: string[]; ratings: string } | null) => void }>()((set) => ({
  orders: {},
  set: (searchId, order) =>
    set((state) => {
      const { [searchId]: _dropped, ...orders } = state.orders;
      return { orders: order ? { ...orders, [searchId]: order } : orders };
    }),
}));

/** `papers` in the order given; any the order doesn't name stay after them, as they were. */
export function inLikelyOrder<Paper extends { id: string }>(papers: Paper[], ids: readonly string[] | undefined): Paper[] {
  if (!ids) return papers;
  const place = new Map(ids.map((id, at) => [id, at]));
  return papers.map((paper, at) => ({ paper, at })).sort((a, b) => (place.get(a.paper.id) ?? ids.length) - (place.get(b.paper.id) ?? ids.length) || a.at - b.at).map(({ paper }) => paper);
}
