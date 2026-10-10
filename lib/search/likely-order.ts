/**
 * A search's results in the order of how likely each is to be one sought, as the papers rated so far
 * say: closest to those rated 4 or 5, and furthest from those rated 1 or 2, as the OpenScholar API
 * orders works by closeness. For a screening, the papers not rated yet come first, the likeliest
 * first, then those already rated. An order is kept for the page's life, per search, with the results
 * and the ratings it was made from, so that it shows only for those results, and can say when the
 * ratings have changed since.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { shortWorkId } from "@/lib/openalex/work-id";

/** The least rating of a paper the order brings others close to. */
export const LIKED_RATING = 4;
/** The most rating of a paper the order moves others away from. */
export const DISLIKED_RATING = 2;
/** The most papers of each kind the API orders by. */
export const MAX_RATED_SEEDS = 100;

/** The papers an order is made by, by their short ids: those rated alike, and those rated unlike. */
export type Seeds = { liked: string[]; disliked: string[] };

/**
 * Among `papers`, in their order, those rated 4 or 5 and those rated 1 or 2, by their short ids, at
 * most MAX_RATED_SEEDS of each. A paper rated 3 says neither.
 */
export function seedsOf(papers: readonly { id: string }[], ratings: Readonly<Record<string, number>>): Seeds {
  const rated = (keep: (rating: number) => boolean) =>
    papers
      .filter((paper) => ratings[paper.id] !== undefined && keep(ratings[paper.id]))
      .map((paper) => shortWorkId(paper.id) ?? paper.id)
      .slice(0, MAX_RATED_SEEDS);
  return { liked: rated((rating) => rating >= LIKED_RATING), disliked: rated((rating) => rating >= 1 && rating <= DISLIKED_RATING) };
}

/** Whether two lists name the same papers, whatever their order. */
export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const named = new Set(left);
  return named.size === left.length && left.length === right.length && right.every((id) => named.has(id));
}

/** Whether two lists of seeds name the same papers, whatever their order. */
export function sameSeeds(left: Seeds, right: Seeds): boolean {
  return sameIds(left.liked, right.liked) && sameIds(left.disliked, right.disliked);
}

/**
 * The papers among `papers` rated in any way, 3 included: which come after those not rated yet. A
 * paper rated 3 moves among them without changing the seeds.
 */
export function ratedOf(papers: readonly { id: string }[], ratings: Readonly<Record<string, number>>): string[] {
  return papers.filter((paper) => ratings[paper.id] !== undefined).map((paper) => paper.id);
}

/** What an order was made for: the results' ids, in their order. */
export function resultsKey(papers: readonly { id: string }[]): string {
  return papers.map((paper) => paper.id).join(" ");
}

/**
 * The likely order of the papers `closest` gives, closest first: those not rated yet first, then those
 * rated, each closest first, as `ratings` has them when the order is made. Fixed then, so that rating
 * a paper later doesn't move it, nor the paper the person is reading.
 */
export function likelyOrder(closest: readonly string[], ratings: Readonly<Record<string, number>>): string[] {
  return [...closest.filter((id) => ratings[id] === undefined), ...closest.filter((id) => ratings[id] !== undefined)];
}

/** `papers` in the order `ids` gives them; a paper the order lacks comes after, as it was. */
export function inOrder<Paper extends { id: string }>(papers: readonly Paper[], ids: readonly string[]): Paper[] {
  const place = new Map(ids.map((id, at) => [id, at]));
  const rank = (paper: Paper) => place.get(paper.id) ?? ids.length;
  return papers.map((paper, at) => ({ paper, at })).sort((left, right) => rank(left.paper) - rank(right.paper) || left.at - right.at).map(({ paper }) => paper);
}

/**
 * An order made for a search: for which results, the results' ids in their likely order, and by which
 * ratings: the seeds, and the papers rated then.
 */
export type LikelyOrder = { key: string; ids: string[]; seeds: Seeds; rated: string[] };

type LikelyOrderState = {
  orders: Record<string, LikelyOrder>;
  setOrder: (searchId: string, order: LikelyOrder) => void;
  clearOrder: (searchId: string) => void;
};

/** The orders made on this page, by search; none survives a reload. */
export const useLikelyOrderStore = create<LikelyOrderState>()((set) => ({
  orders: {},
  setOrder: (searchId, order) => set((state) => ({ orders: { ...state.orders, [searchId]: order } })),
  clearOrder: (searchId) =>
    set((state) => {
      const { [searchId]: _cleared, ...orders } = state.orders;
      return { orders };
    }),
}));

/**
 * `kept`, the results a list keeps, in the order made for `searchId` when it was made for `results`,
 * the search's results as they are now; as they are, when no order was, or it was for other results.
 */
export function useLikelyOrdered<Paper extends { id: string }>(
  searchId: string | undefined,
  results: readonly { id: string }[],
  kept: Paper[],
): Paper[] {
  const order = useLikelyOrderStore((state) => (searchId ? state.orders[searchId] : undefined));
  const key = resultsKey(results);
  return useMemo(() => (order?.key === key ? inOrder(kept, order.ids) : kept), [order, key, kept]);
}
