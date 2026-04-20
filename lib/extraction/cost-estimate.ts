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

export function estimateExtractionCredits(
  args: ExtractionEstimateArgs,
): ExtractionCostEstimate {
  if (args.papers === 0) return { low: 0, mid: 0, high: 0 };
  throw new Error("not implemented");
}
