import { describe, expect, it } from "vitest";
import type { PaperWithResults } from "../lib/extraction/filtering";
import { getAvgConfidence } from "../lib/extraction/filtering";
import { getStatusFilterOptionIds } from "../lib/extraction/status-filter-options";

describe("extraction result page helpers", () => {
  it("calculates average confidence from the visible page rows", () => {
    const paper = {
      results: [{ confidence: 0.25 }, { confidence: 0.75 }, { confidence: 1 }],
    } as unknown as PaperWithResults;

    expect(getAvgConfidence(paper)).toBeCloseTo(2 / 3);
  });

  it("returns zero confidence when a paper has no visible result rows", () => {
    const paper = {
      results: [],
    } as unknown as PaperWithResults;

    expect(getAvgConfidence(paper)).toBe(0);
  });

  it("removes has-pdf from the status options when the PDF feature is disabled", () => {
    expect(getStatusFilterOptionIds(false)).not.toContain("has-pdf");
    expect(getStatusFilterOptionIds(true)).toContain("has-pdf");
  });
});
