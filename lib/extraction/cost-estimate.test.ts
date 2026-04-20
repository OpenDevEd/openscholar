import { describe, expect, it } from "vitest";
import {
  estimateExtractionCredits,
  EXTRACTION_COST_CONSTANTS,
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
});
