/**
 * Pre-flight validation for any mutation or action that accepts a user-supplied bucket: its
 * papers, counted after expansion, fit what the person's plan takes in one request (#632).
 */
import { effectivePaperCount, type EffectiveCountItem } from "../../../lib/bucket/effective-paper-count";
import { createError } from "../../lib/errors";

/**
 * Counts the papers a bucket will produce (a search row counts its `searchFilters.limit`, a
 * screening its included papers, any other row one) and refuses an empty bucket or one past
 * `planPapers`, when the plan sets a limit. Throws the project-standard `VALIDATION_ERROR`.
 */
export function assertBucketWithinLimits(items: ReadonlyArray<EffectiveCountItem>, planPapers?: number): {
  effectiveCount: number;
} {
  const count = effectivePaperCount(items);
  // An empty bucket would set a job up only to find nothing to read: refused before it's made.
  if (count === 0) throw createError("VALIDATION_ERROR", "Bucket must include at least one paper");
  if (planPapers !== undefined && count > planPapers) {
    throw createError("VALIDATION_ERROR", `Your plan takes up to ${planPapers.toLocaleString("en")} papers in one extraction. Pick fewer, or change plan for more.`);
  }
  return { effectiveCount: count };
}
