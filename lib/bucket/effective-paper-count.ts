/**
 * How many papers a staged bucket produces once its rows expand at job-submit time: what the
 * person's plan caps (convex/extraction/bucket/limits.ts).
 *
 * - A saved-search placeholder (`source === "history"` with `searchFilters`) expands to
 *   `searchFilters.limit` papers; one saved without a count pulls PAPER_PULL_DEFAULT.
 * - A screening expands to its included papers, and a library or collection range to its papers.
 * - Every other row (library, collection, zotero, upload, a single history paper) is one.
 *
 * The cap is measured against this sum, not the row count: one placeholder with
 * `limit=200` is 200 papers.
 */
import { PAPER_PULL_DEFAULT } from "../extraction/limits";

export type EffectiveCountItem = {
  source: "history" | "library" | "collection" | "zotero" | "upload" | "screening";
  screeningSelection?: { count: number };
  librarySet?: { count: number };
  searchFilters?: { limit?: number } & Record<string, unknown>;
};

/** Papers a single bucket row produces. A negative or NaN limit is 0: setup skips the row. */
export function paperCountForItem(item: EffectiveCountItem): number {
  if (item.source === "screening") return item.screeningSelection?.count ?? 0;
  if (item.librarySet) return item.librarySet.count;
  if (item.source !== "history" || !item.searchFilters) return 1;
  const raw = item.searchFilters.limit ?? PAPER_PULL_DEFAULT;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

/** Papers the whole bucket produces. */
export function effectivePaperCount(items: ReadonlyArray<EffectiveCountItem>): number {
  let total = 0;
  for (const item of items) total += paperCountForItem(item);
  return total;
}
