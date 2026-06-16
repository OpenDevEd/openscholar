/**
 * Pure, server-side effective paper-count math for a staged bucket.
 *
 * The bucket carries two row shapes that differ in how they expand at
 * job-submit time:
 *
 *  - **Saved-search history placeholders** — `source === "history"` with
 *    a `searchFilters` blob attached. They expand to `searchFilters.limit`
 *    actual papers when queue setup runs `fetchPapersFromHistory`. An
 *    unset limit falls back to the OpenAlex single-page ceiling, which is
 *    the same value as the per-row pull cap.
 *  - **Per-paper rows** — every other source (library, collection, zotero,
 *    upload, history-as-individual-paper). One row, one paper.
 *
 * The plan-level paper cap (`getPaperLimit`) MUST be measured against the
 * post-expansion sum, not against the row count: a single placeholder
 * with `limit=200` would otherwise pass `items.length ≤ 1000` and then
 * schedule 200 papers; a thousand of them would schedule 200,000.
 *
 * Per-row clamp: `searchFilters.limit > pullCap` is rejected up-front in
 * the mutation (see `assertPaperPullCap`) so the math here can trust the
 * stored value to be in [0, pullCap].
 */

export type EffectiveCountItem = {
  source: "history" | "library" | "collection" | "zotero" | "upload";
  searchFilters?: { limit?: number } & Record<string, unknown>;
};

/**
 * Papers a single bucket row will produce at submit time, clamped to
 * `pullCap`. Negative or NaN limits collapse to 0 — queue setup treats
 * them as "skip this row".
 */
export function paperCountForItem(
  item: EffectiveCountItem,
  pullCap: number,
): number {
  if (item.source !== "history" || !item.searchFilters) return 1;
  const raw = item.searchFilters.limit;
  if (raw === undefined) return pullCap;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), pullCap);
}

/**
 * Total paper count the bucket will produce at submit time, summed
 * across rows after each row is clamped to `pullCap`.
 */
export function effectivePaperCount(
  items: ReadonlyArray<EffectiveCountItem>,
  pullCap: number,
): number {
  let total = 0;
  for (const item of items) total += paperCountForItem(item, pullCap);
  return total;
}

/**
 * Pre-flight per-row validation: rejects any history row whose stored
 * `searchFilters.limit` exceeds the plan's per-row pull cap. Throws so
 * the caller can wrap in the project-standard `createError`.
 *
 * Returns the offending item's index for caller-side error formatting,
 * or -1 if the bucket is clean.
 */
export function findOverPullCapIndex(
  items: ReadonlyArray<EffectiveCountItem>,
  pullCap: number,
): number {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.source !== "history" || !item.searchFilters) continue;
    const raw = item.searchFilters.limit;
    if (raw !== undefined && Number.isFinite(raw) && raw > pullCap) return i;
  }
  return -1;
}
