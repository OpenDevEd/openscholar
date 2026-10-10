/**
 * A search's results in the order of how likely each is to be one sought, as the papers rated so far
 * say: closest to those rated 4 or 5, and furthest from those rated 1 or 2, as the OpenScholar API
 * orders works by closeness. For a screening, the papers not rated yet come first, the likeliest
 * first, then those already rated. An order is kept for the page's life, per search, with the results
 * and the ratings it was made from, so that it shows only for those results, and can say when the
 * ratings have changed since.
 */
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

/** Whether two lists of seeds name the same papers, whatever their order. */
export function sameSeeds(left: Seeds, right: Seeds): boolean {
  const same = (a: string[], b: string[]) => {
    const named = new Set(a);
    return named.size === a.length && a.length === b.length && b.every((id) => named.has(id));
  };
  return same(left.liked, right.liked) && same(left.disliked, right.disliked);
}

/** What an order was made for: the results' ids, in their order. */
export function resultsKey(papers: readonly { id: string }[]): string {
  return papers.map((paper) => paper.id).join(" ");
}

/**
 * `papers` in the order `ids` gives them: those not rated yet first, then those rated, each in that
 * order; a paper the order lacks comes after, as it was.
 */
export function inLikelyOrder<Paper extends { id: string }>(papers: readonly Paper[], ids: readonly string[], ratings: Readonly<Record<string, number>>): Paper[] {
  const place = new Map(ids.map((id, at) => [id, at]));
  // The papers not rated take the first places, those rated the next, and those the order lacks the last.
  const rank = (paper: Paper) => {
    const at = place.get(paper.id);
    if (at === undefined) return 2 * ids.length;
    return ratings[paper.id] === undefined ? at : ids.length + at;
  };
  return papers.map((paper, at) => ({ paper, at })).sort((left, right) => rank(left.paper) - rank(right.paper) || left.at - right.at).map(({ paper }) => paper);
}

/** An order made for a search: for which results, the results' ids in it, and by which ratings. */
export type LikelyOrder = { key: string; ids: string[]; seeds: Seeds };

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
