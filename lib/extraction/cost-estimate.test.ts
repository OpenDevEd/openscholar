import { describe, expect, it } from "vitest";
import { estimateExtractionCredits } from "@/lib/extraction/cost-estimate";

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
});
