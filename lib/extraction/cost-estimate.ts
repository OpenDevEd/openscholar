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

// Abstract-tier constants recalibrated from 2,821 production
// `creditTransactions` rows where billingType="extraction_llm":
//   mean=2.02, p10≈1, p50=2, p90=3, p95=3, p99=5, max=9
// LOW=1 (p10), MID=2 (mean/p50), HIGH=5 (p99). HIGH is the preflight
// block threshold; with n=2821 only 1% of questions exceed it and the
// worst observed overshoot is +4 credits — bounded blast radius even
// for large jobs. R9 (`high ≥ 1.2 × mid`) holds at 5/2 = 2.5×.
//
// PDF-tier constants are unchanged: zero PDF transactions in the
// dataset, so 10/20/50 + INDEX_PDF_CREDIT=1.5 are still derived from
// RAG embedding pricing ($0.02/1M tokens × AI_COST_MARKUP=1.3 ×
// 10k credits/USD). Re-probe once PDF jobs accumulate real data.
export const EXTRACTION_COST_CONSTANTS = {
  INDEX_PDF_CREDIT: 1.5,
  ABSTRACT_Q_CREDIT_LOW: 1,
  ABSTRACT_Q_CREDIT_MID: 2,
  ABSTRACT_Q_CREDIT_HIGH: 5,
  PDF_Q_CREDIT_LOW: 10,
  PDF_Q_CREDIT_MID: 20,
  PDF_Q_CREDIT_HIGH: 50,
} as const;

/**
 * The model price the per-question figures hold at, in USD per million tokens: a small
 * model's. Measured again on 2026-10-05: GPT-6 Luna at this price cost 3 to 5 credits an
 * abstract question, and Claude Sonnet 5.5 at twenty times the price cost 49 to 65.
 */
const MEASURED_AT = { input: 0.1, output: 0.5 };

/**
 * How many times the per-question figures a job's questions cost on its model: the model's
 * price over the price they were measured at, and never less than once.
 */
export function priceScale(pricing: { input: number; output: number } | null | undefined): number {
  return pricing ? Math.max(1, pricing.input / MEASURED_AT.input, pricing.output / MEASURED_AT.output) : 1;
}

/**
 * Credits held before one paper runs: every question at the high rate, plus indexing for a
 * PDF. `scale` is the job's model against the small one the rates were measured on
 * (`priceScale`); without it the rates are that model's.
 */
export function estimatePaperCredits(args: { questionCount: number; pdf: boolean; scale?: number }): number {
  const c = EXTRACTION_COST_CONSTANTS;
  const scale = args.scale ?? 1;
  return args.pdf
    ? Math.ceil(c.INDEX_PDF_CREDIT) + Math.ceil(args.questionCount * c.PDF_Q_CREDIT_HIGH * scale)
    : Math.ceil(args.questionCount * c.ABSTRACT_Q_CREDIT_HIGH * scale);
}

export function estimateExtractionCredits(
  args: ExtractionEstimateArgs,
): ExtractionCostEstimate {
  if (args.papers === 0 || args.questions === 0) {
    return { low: 0, mid: 0, high: 0 };
  }
  const c = EXTRACTION_COST_CONSTANTS;
  const qPairs = args.papers * args.questions;
  const isPdfTier = args.usePdfs || args.avgPaperKind === "pdf";

  if (isPdfTier) {
    const indexCost = args.papers * c.INDEX_PDF_CREDIT;
    return {
      low: indexCost + qPairs * c.PDF_Q_CREDIT_LOW,
      mid: indexCost + qPairs * c.PDF_Q_CREDIT_MID,
      high: indexCost + qPairs * c.PDF_Q_CREDIT_HIGH,
    };
  }

  return {
    low: qPairs * c.ABSTRACT_Q_CREDIT_LOW,
    mid: qPairs * c.ABSTRACT_Q_CREDIT_MID,
    high: qPairs * c.ABSTRACT_Q_CREDIT_HIGH,
  };
}

/**
 * Plan-05 retry-only estimator.
 *
 * Indexing cost is NOT charged (retry reuses the already-indexed PDF
 * because the retry mutation skips papers already indexed). The estimate
 * is therefore a pure per-(paper, question) multiple of the same LLM
 * tier constants that `estimateExtractionCredits` uses.
 */
export function estimateRetryCredits(args: {
  retryableCount: number;
  usePdfs: boolean;
  avgPaperKind: AvgPaperKind;
}): ExtractionCostEstimate {
  if (args.retryableCount <= 0) {
    return { low: 0, mid: 0, high: 0 };
  }
  const c = EXTRACTION_COST_CONSTANTS;
  const isPdfTier = args.usePdfs || args.avgPaperKind === "pdf";
  const perQLow = isPdfTier ? c.PDF_Q_CREDIT_LOW : c.ABSTRACT_Q_CREDIT_LOW;
  const perQMid = isPdfTier ? c.PDF_Q_CREDIT_MID : c.ABSTRACT_Q_CREDIT_MID;
  const perQHigh = isPdfTier ? c.PDF_Q_CREDIT_HIGH : c.ABSTRACT_Q_CREDIT_HIGH;
  return {
    low: args.retryableCount * perQLow,
    mid: args.retryableCount * perQMid,
    high: args.retryableCount * perQHigh,
  };
}
