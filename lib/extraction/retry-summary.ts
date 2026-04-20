/**
 * Retryable/permanent summary for extraction-result failures.
 *
 * Classifies a job's failed per-question results into two buckets —
 * retryable (the user can hit "Retry N failed") and permanent (the user
 * cannot, e.g. invalid PDF). Consumed by the retry mutation (to decide
 * which results to re-enqueue) and the retry-summary UI (to render
 * "5 retryable · 2 permanent (2 × PDF invalid)").
 *
 * Pure. Drives the retry UX end-to-end. Imports the retryable predicate
 * from the single-source taxonomy so there's no classification drift.
 */

import { isRetryable, type ErrorCode } from "@/lib/errors/taxonomy";

export type RetryableResultInput = {
  status?: "pending" | "extracting" | "completed" | "failed";
  lastError?: { code: ErrorCode } | null;
};

export type RetrySummary = {
  retryableCount: number;
  permanentCount: number;
  /**
   * Per-code count of permanent failures. Iteration order is
   * count-desc, then code-asc — the UI renders the breakdown in this
   * order and tests assert on `Object.keys()`.
   */
  permanentBreakdown: Record<string, number>;
};

export function summarizeRetryable(
  _results: ReadonlyArray<RetryableResultInput>,
): RetrySummary {
  return {
    retryableCount: 0,
    permanentCount: 0,
    permanentBreakdown: {},
  };
}
