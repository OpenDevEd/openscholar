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

import { isRetryable } from "@/lib/errors/taxonomy";

export type RetryableResultInput = {
  status?: "pending" | "extracting" | "completed" | "failed";
  // `code` widened from ErrorCode to string for forward-compat: if the
  // classifier evolves ahead of this module, unknown codes route to the
  // retryable bucket (see R7) rather than trapping the user.
  lastError?: { code: string } | null;
};

const retryableTable: Record<string, boolean | undefined> = isRetryable;

/**
 * Is a failed extractionResults row retryable? Single source the
 * retry mutation and the summarizer both consume — keeps the
 * "unknown code → retryable" forward-compat rule (see R7) in one
 * place instead of duplicating the `=== false` comparison.
 */
export function isResultRetryableFailure(
  result: RetryableResultInput,
): boolean {
  if (result.status !== "failed") return false;
  const code = result.lastError?.code;
  // Treat missing code + taxonomy-unknown codes as retryable (never
  // trap the user on codes the classifier hasn't caught up to).
  return !code || retryableTable[code] !== false;
}

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
    if (isResultRetryableFailure(r)) {
      retryableCount += 1;
    } else {
      // Non-retryable failed result ⇒ code is present and known-permanent.
      const code = r.lastError?.code ?? "unknown";
      counts.set(code, (counts.get(code) ?? 0) + 1);
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
