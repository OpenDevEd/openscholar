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
  results: ReadonlyArray<RetryableResultInput>,
): RetrySummary {
  let retryableCount = 0;
  const counts = new Map<string, number>();

  for (const r of results) {
    if (r.status !== "failed") continue;
    const code = r.lastError?.code;
    if (code && isRetryable[code] === false) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    } else {
      retryableCount += 1;
    }
  }

  // Insert into the returned object in count-desc, code-asc order so
  // Object.keys/entries iterate in the UI's render order. Modern JS
  // preserves string-key insertion order on plain objects.
  const sorted = [...counts.entries()].sort(([codeA, countA], [codeB, countB]) => {
    if (countB !== countA) return countB - countA;
    return codeA < codeB ? -1 : codeA > codeB ? 1 : 0;
  });

  const permanentBreakdown: Record<string, number> = {};
  let permanentCount = 0;
  for (const [code, count] of sorted) {
    permanentBreakdown[code] = count;
    permanentCount += count;
  }

  return { retryableCount, permanentCount, permanentBreakdown };
}
