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
 * Plan-06 resume-time remaining estimator.
 *
 * Called by `resumeExtraction` when resuming a `creditsExhausted` job
 * to decide whether the user's topped-up balance now covers what's
 * left. Counts:
 *   - `remainingQuestions`: non-completed, non-billed extractionResults
 *     (the LLM calls still owed)
 *   - `unindexedPapers`: papers without `indexingBilled === true` (each
 *     still owes an indexing charge on PDF-tier jobs)
 *
 * Returns the same `{low, mid, high}` shape as the other estimators so
 * the caller can block on `high` (conservative — better to refuse resume
 * than fall into creditsExhausted again immediately).
 */
export function estimateRemainingCredits(args: {
  remainingQuestions: number;
  unindexedPapers: number;
  usePdfs: boolean;
  avgPaperKind: AvgPaperKind;
}): ExtractionCostEstimate {
  const c = EXTRACTION_COST_CONSTANTS;
  const isPdfTier = args.usePdfs || args.avgPaperKind === "pdf";
  const indexCost = isPdfTier ? args.unindexedPapers * c.INDEX_PDF_CREDIT : 0;

  const perQLow = isPdfTier ? c.PDF_Q_CREDIT_LOW : c.ABSTRACT_Q_CREDIT_LOW;
  const perQMid = isPdfTier ? c.PDF_Q_CREDIT_MID : c.ABSTRACT_Q_CREDIT_MID;
  const perQHigh = isPdfTier ? c.PDF_Q_CREDIT_HIGH : c.ABSTRACT_Q_CREDIT_HIGH;

  return {
    low: indexCost + args.remainingQuestions * perQLow,
    mid: indexCost + args.remainingQuestions * perQMid,
    high: indexCost + args.remainingQuestions * perQHigh,
  };
}

/**
 * Plan-05 retry-only estimator.
 *
 * Indexing cost is NOT charged (retry reuses the already-indexed PDF
 * per the `indexingBilled` guard in the retry mutation). The estimate
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
