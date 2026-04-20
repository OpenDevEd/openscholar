/**
 * Pre-flight credit estimator for extraction jobs.
 *
 * Returns {low, mid, high} so the UI can show a range ("~240 credits (200–290)")
 * and the pre-flight gate can block against `high` (conservative — better block
 * than fail mid-run).
 *
 * Constants are exported as EXTRACTION_COST_CONSTANTS for re-tuning.
 * TODO: re-calibrate once we have 30 days of `creditTransactions` data
 * (billingType "extraction_llm" + "extraction_embedding").
 */

export type AvgPaperKind = "abstract" | "pdf";

export type ExtractionCostEstimate = {
  low: number;
  mid: number;
  high: number;
};

export type ExtractionEstimateArgs = {
  papers: number;
  questions: number;
  usePdfs: boolean;
  avgPaperKind: AvgPaperKind;
};

// Conservative over-estimates — we prefer blocking preflight over mid-run
// failure. Derived empirically from screening's ESTIMATED_CREDITS_PER_QUERY=2
// floor (convex/lib/constants.ts) and RAG embedding pricing at
// $0.02/1M tokens × AI_COST_MARKUP=1.3 × 10k credits/USD.
// TODO(plan-03): re-calibrate from creditTransactions once 30 days of
// billingType="extraction_llm" / "extraction_embedding" data exists.
export const EXTRACTION_COST_CONSTANTS = {
  INDEX_PDF_CREDIT: 1.5,
  ABSTRACT_Q_CREDIT_LOW: 3,
  ABSTRACT_Q_CREDIT_MID: 6,
  ABSTRACT_Q_CREDIT_HIGH: 12,
  PDF_Q_CREDIT_LOW: 10,
  PDF_Q_CREDIT_MID: 20,
  PDF_Q_CREDIT_HIGH: 50,
} as const;

export function estimateExtractionCredits(
  args: ExtractionEstimateArgs,
): ExtractionCostEstimate {
  if (args.papers === 0 || args.questions === 0) {
    return { low: 0, mid: 0, high: 0 };
  }
  const c = EXTRACTION_COST_CONSTANTS;
  const qPairs = args.papers * args.questions;
  return {
    low: qPairs * c.ABSTRACT_Q_CREDIT_LOW,
    mid: qPairs * c.ABSTRACT_Q_CREDIT_MID,
    high: qPairs * c.ABSTRACT_Q_CREDIT_HIGH,
  };
}
