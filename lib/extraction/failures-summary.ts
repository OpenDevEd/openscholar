/**
 * Failures-by-code summarizer for extraction `extractionPaperErrors`
 * rows. Feeds the mixed-success callout and the error-history side
 * panel. Pure — no Convex dependency — so the UI can compute it from
 * any source (live query, snapshot, test fixture) without a round trip.
 */

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

export function summarizeFailures(
  _failures: ReadonlyArray<FailureInput>,
): FailuresSummary {
  return { total: 0, byCode: [] };
}
