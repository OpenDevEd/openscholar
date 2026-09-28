/**
 * Pre-flight validation for any mutation or action that accepts a
 * user-supplied bucket. The limits themselves live in lib/extraction/limits.ts.
 */
import {
  effectivePaperCount,
  findOverPullCapIndex,
  type EffectiveCountItem,
} from "../../../lib/bucket/effective-paper-count";
import { PAPER_LIMIT, PAPER_PULL_CAP } from "../../../lib/extraction/limits";
import { createError } from "../../lib/errors";

/**
 * Enforces both:
 *
 *  1. Per-row pull cap — no history row may request more than
 *     `PAPER_PULL_CAP` papers via `searchFilters.limit`. Catches crafted
 *     requests that try to bypass the row-count limit by inflating one row.
 *  2. Paper cap — the post-expansion sum (history rows count their
 *     `searchFilters.limit`, others count 1) must fit `PAPER_LIMIT`. Catches
 *     crafted requests that multiply rows × per-row limit past the cap.
 *
 * Throws the project-standard `VALIDATION_ERROR` so callers don't have
 * to handle it.
 */
export function assertBucketWithinLimits(items: ReadonlyArray<EffectiveCountItem>): {
  effectiveCount: number;
} {
  const overIndex = findOverPullCapIndex(items, PAPER_PULL_CAP);
  if (overIndex !== -1) {
    throw createError(
      "VALIDATION_ERROR",
      `Bucket row ${overIndex} requests more than the per-row pull cap of ${PAPER_PULL_CAP} papers`,
    );
  }

  const count = effectivePaperCount(items, PAPER_PULL_CAP);
  // Reject empty buckets up-front. A bucket with zero effective papers
  // (e.g. every history row has `searchFilters.limit <= 0`) would
  // otherwise pass the cap check, spin up queue setup, advance the
  // job to `downloading_pdfs`/`indexing`, and only then throw — leaving
  // the job stranded in an intermediate status. Fail fast so the client
  // sees a synchronous VALIDATION_ERROR and no job is ever created.
  if (count === 0) {
    throw createError("VALIDATION_ERROR", "Bucket must include at least one paper");
  }
  if (count > PAPER_LIMIT) {
    throw createError(
      "VALIDATION_ERROR",
      `Bucket would produce ${count} papers, exceeding the limit of ${PAPER_LIMIT}`,
    );
  }

  return { effectiveCount: count };
}
