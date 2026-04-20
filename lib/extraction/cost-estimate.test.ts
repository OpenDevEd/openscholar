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
});
