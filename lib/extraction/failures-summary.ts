/**
 * Failures-by-code summarizer for extraction `extractionPaperErrors`
 * rows. Feeds the mixed-success callout and the error-history side
 * panel. Pure — no Convex dependency — so the UI can compute it from
 * any source (live query, snapshot, test fixture) without a round trip.
 */

import { isRetryable } from "@/lib/errors/taxonomy";

export type FailureInput = {
  code: string;
};

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
  failures: ReadonlyArray<FailureInput>,
): FailuresSummary {
  const counts = new Map<string, number>();
  for (const f of failures) {
    counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  }

  const byCode: FailureByCode[] = [];
  for (const [code, count] of counts) {
    byCode.push({ code, count, retryable: resolveRetryable(code) });
  }

  return { total: failures.length, byCode };
}
