/**
 * How many papers a staged bucket produces once its rows expand at job-submit time: what the
 * person's plan caps (convex/extraction/bucket/limits.ts).
 *
 * - A saved-search placeholder (`source === "history"` with `searchFilters`) expands to its
 *   results `searchFilters.first` (1 when left out) to `searchFilters.limit`; one saved
 *   without a count pulls PAPER_PULL_DEFAULT.
 * - A screening expands to its included papers, a library or collection range to its papers, and
 *   an Evidence Library range to its records `first` to `last` (fewer when the source holds fewer).
 * - Every other row (library, collection, zotero, upload, a single history paper) is one.
 *
 * The cap is measured against this sum, not the row count: one placeholder with
 * `limit=200` is 200 papers.
 */
import { PAPER_PULL_DEFAULT } from "../extraction/limits";

export type EffectiveCountItem = {
  source: "history" | "library" | "collection" | "zotero" | "upload" | "screening" | "evidenceLibrary";
  screeningSelection?: { count: number };
  librarySet?: { count: number };
  zoteroSet?: { first: number; last: number };
  evidenceLibrarySet?: { first: number; last: number };
  searchFilters?: { first?: number; limit?: number } & Record<string, unknown>;
};

/** Papers a single bucket row produces. A negative or NaN limit is 0: setup skips the row. */
export function paperCountForItem(item: EffectiveCountItem): number {
  if (item.source === "screening") return item.screeningSelection?.count ?? 0;
  if (item.librarySet) return item.librarySet.count;
  if (item.zoteroSet) return Math.max(0, item.zoteroSet.last - item.zoteroSet.first + 1);
  if (item.evidenceLibrarySet) return Math.max(0, item.evidenceLibrarySet.last - item.evidenceLibrarySet.first + 1);
  if (item.source !== "history" || !item.searchFilters) return 1;
  const raw = item.searchFilters.limit ?? PAPER_PULL_DEFAULT;
  const first = item.searchFilters.first ?? 1;
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(first) || first < 1) return 0;
  return Math.max(0, Math.floor(raw) - Math.floor(first) + 1);
}

/** Papers the whole bucket produces. */
export function effectivePaperCount(items: ReadonlyArray<EffectiveCountItem>): number {
  let total = 0;
  for (const item of items) total += paperCountForItem(item);
  return total;
}
