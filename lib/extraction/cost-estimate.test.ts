import { describe, expect, it } from "vitest";
import {
  estimateExtractionCredits,
  estimateRetryCredits,
  EXTRACTION_COST_CONSTANTS,
  type ExtractionEstimateArgs,
  estimatePaperCredits,
  priceScale,
} from "@/lib/extraction/cost-estimate";

describe("estimateExtractionCredits", () => {
  it("R1: zero papers → zero low/mid/high (guard against silly positive estimates for empty jobs)", () => {
    expect(
      estimateExtractionCredits({
        papers: 0,
        questions: 5,
        usePdfs: false,
        avgPaperKind: "abstract",
      }),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("R2: zero papers AND zero questions → zero (bivariate zero)", () => {
    expect(
      estimateExtractionCredits({
        papers: 0,
        questions: 0,
        usePdfs: false,
        avgPaperKind: "abstract",
      }),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("R2b: zero questions with positive papers → zero (no questions, no LLM work)", () => {
    expect(
      estimateExtractionCredits({
        papers: 10,
        questions: 0,
        usePdfs: false,
        avgPaperKind: "abstract",
      }),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("R3: 10 papers × 5 Qs × abstracts → mid = 10 * 5 * ABSTRACT_Q_CREDIT_MID (no indexing, no PDF markup)", () => {
    const { mid } = estimateExtractionCredits({
      papers: 10,
      questions: 5,
      usePdfs: false,
      avgPaperKind: "abstract",
    });
    expect(mid).toBe(10 * 5 * EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_MID);
  });

  it("R4: 10 papers × 5 Qs × PDFs → mid includes indexing + PDF-tier LLM cost", () => {
    const { mid } = estimateExtractionCredits({
      papers: 10,
      questions: 5,
      usePdfs: true,
      avgPaperKind: "pdf",
    });
    const expected =
      10 * EXTRACTION_COST_CONSTANTS.INDEX_PDF_CREDIT +
      10 * 5 * EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_MID;
    expect(mid).toBe(expected);
  });

  it("R5: high ≥ mid ≥ low invariant across a sampled matrix of shapes", () => {
    const matrix: Array<{
      papers: number;
      questions: number;
      usePdfs: boolean;
      avgPaperKind: "abstract" | "pdf";
    }> = [
      { papers: 1, questions: 1, usePdfs: false, avgPaperKind: "abstract" },
      { papers: 5, questions: 3, usePdfs: false, avgPaperKind: "abstract" },
      { papers: 50, questions: 1, usePdfs: true, avgPaperKind: "pdf" },
      { papers: 3, questions: 12, usePdfs: true, avgPaperKind: "pdf" },
      { papers: 200, questions: 8, usePdfs: false, avgPaperKind: "abstract" },
      { papers: 100, questions: 5, usePdfs: true, avgPaperKind: "abstract" },
    ];
    for (const args of matrix) {
      const { low, mid, high } = estimateExtractionCredits(args);
      expect(high).toBeGreaterThanOrEqual(mid);
      expect(mid).toBeGreaterThanOrEqual(low);
    }
  });

  it("R6: strictly monotonic in papers (doubling papers increases mid)", () => {
    const base = { questions: 4, usePdfs: false, avgPaperKind: "abstract" as const };
    const small = estimateExtractionCredits({ ...base, papers: 10 });
    const large = estimateExtractionCredits({ ...base, papers: 20 });
    expect(large.mid).toBeGreaterThan(small.mid);
    expect(large.low).toBeGreaterThan(small.low);
    expect(large.high).toBeGreaterThan(small.high);
  });

  it("R7: strictly monotonic in questions (doubling questions increases mid)", () => {
    const base = { papers: 10, usePdfs: true, avgPaperKind: "pdf" as const };
    const small = estimateExtractionCredits({ ...base, questions: 3 });
    const large = estimateExtractionCredits({ ...base, questions: 6 });
    expect(large.mid).toBeGreaterThan(small.mid);
    expect(large.low).toBeGreaterThan(small.low);
    expect(large.high).toBeGreaterThan(small.high);
  });

  it("R8: usePdfs=true overrides avgPaperKind='abstract' → PDF-tier math wins", () => {
    const result = estimateExtractionCredits({
      papers: 10,
      questions: 5,
      usePdfs: true,
      avgPaperKind: "abstract",
    });
    const pdfExpected =
      10 * EXTRACTION_COST_CONSTANTS.INDEX_PDF_CREDIT +
      10 * 5 * EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_MID;
    expect(result.mid).toBe(pdfExpected);
    // Sanity: not the cheaper abstract-path number.
    const abstractWould = 10 * 5 * EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_MID;
    expect(result.mid).toBeGreaterThan(abstractWould);
  });

  it("R9: widening factor — high is always ≥ 1.2 × mid when papers > 0 (safety margin for preflight block)", () => {
    const matrix: Array<ExtractionEstimateArgs> = [
      { papers: 1, questions: 1, usePdfs: false, avgPaperKind: "abstract" },
      { papers: 10, questions: 5, usePdfs: false, avgPaperKind: "abstract" },
      { papers: 10, questions: 5, usePdfs: true, avgPaperKind: "pdf" },
      { papers: 200, questions: 10, usePdfs: true, avgPaperKind: "pdf" },
    ];
    for (const args of matrix) {
      const { mid, high } = estimateExtractionCredits(args);
      expect(high).toBeGreaterThanOrEqual(mid * 1.2);
    }
  });
});

describe("estimateRetryCredits (plan-05)", () => {
  it("zero retryable → zero estimate (nothing to block on)", () => {
    expect(
      estimateRetryCredits({
        retryableCount: 0,
        usePdfs: false,
        avgPaperKind: "abstract",
      }),
    ).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it("abstract tier — 5 retryable Qs → 5 × per-Q constants (no indexing cost)", () => {
    const est = estimateRetryCredits({
      retryableCount: 5,
      usePdfs: false,
      avgPaperKind: "abstract",
    });
    expect(est).toEqual({
      low: 5 * EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_LOW,
      mid: 5 * EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_MID,
      high: 5 * EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_HIGH,
    });
  });

  it("PDF tier skips indexing cost (PDFs already billed via indexingBilled guard)", () => {
    const est = estimateRetryCredits({
      retryableCount: 5,
      usePdfs: true,
      avgPaperKind: "pdf",
    });
    // Crucially: no `INDEX_PDF_CREDIT` term — retry never re-indexes.
    expect(est).toEqual({
      low: 5 * EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_LOW,
      mid: 5 * EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_MID,
      high: 5 * EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_HIGH,
    });
  });

  it("high ≥ mid ≥ low invariant", () => {
    const args = {
      retryableCount: 7,
      usePdfs: true,
      avgPaperKind: "pdf" as const,
    };
    const { low, mid, high } = estimateRetryCredits(args);
    expect(high).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(low);
  });
});

describe("a job's model against the one the rates were measured on", () => {
  it("scales a paper's hold by the model's price, and never below the measured rates", () => {
    // Claude Sonnet 5.5 on 2026-10-05: $2 and $10 a million tokens, twenty times the small model's.
    expect(priceScale({ input: 2, output: 10 })).toBe(20);
    expect(priceScale({ input: 0.05, output: 0.2 })).toBe(1);
    expect(priceScale(null)).toBe(1);
    // Two abstract questions hold 10 credits on the small model, and 200 on Sonnet, where they cost 107 to 130.
    expect(estimatePaperCredits({ questionCount: 2, pdf: false })).toBe(10);
    expect(estimatePaperCredits({ questionCount: 2, pdf: false, scale: 20 })).toBe(200);
  });
});
