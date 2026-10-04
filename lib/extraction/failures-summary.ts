/**
 * Failures-by-code summary for a job's paper errors, from their counts per code
 * (`convex/extraction/resultCounts.ts`). Feeds the mixed-success callout.
 */

import { isRetryable } from "@/lib/errors/taxonomy";

export type FailureByCode = {
  code: string;
  count: number;
  retryable: boolean;
};

export type FailuresSummary = {
  total: number;
  byCode: FailureByCode[];
};

const retryableTable: Record<string, boolean | undefined> = isRetryable;

/**
 * Unknown codes (not in the taxonomy) default to retryable:true so a
 * future classifier revision that produces a code this module has not
 * been taught about never traps the user behind a non-retryable label.
 */
function resolveRetryable(code: string): boolean {
  return retryableTable[code] !== false;
}

export function summarizeFailures(
  counts: Readonly<Record<string, number | undefined>>,
): FailuresSummary {
  const byCode: FailureByCode[] = Object.entries(counts)
    .flatMap(([code, count]) => (count ? [[code, count] as const] : []))
    .sort(([codeA, countA], [codeB, countB]) => {
      if (countB !== countA) return countB - countA;
      return codeA < codeB ? -1 : codeA > codeB ? 1 : 0;
    })
    .map(([code, count]) => ({
      code,
      count,
      retryable: resolveRetryable(code),
    }));

  return { total: byCode.reduce((sum, { count }) => sum + count, 0), byCode };
}
