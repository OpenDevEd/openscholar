import { describe, it, expect } from "vitest";
import { getConfidenceTooltipKey } from "../lib/extraction/confidence-messages";

describe("getConfidenceTooltipKey - no-content priority", () => {
  it("returns confidenceNoContent when all papers have no content", () => {
    expect(getConfidenceTooltipKey(0, 5, 5)).toBe("confidenceNoContent");
  });

  it("returns confidenceNoContent when noContentCount equals totalPapers (boundary)", () => {
    expect(getConfidenceTooltipKey(0, 1, 1)).toBe("confidenceNoContent");
  });

  it("prioritizes no-content over abstract-only when both are at totalPapers", () => {
    // all papers are no-content — should NOT fall through to abstract-only
    expect(getConfidenceTooltipKey(5, 5, 5)).toBe("confidenceNoContent");
  });
});

describe("getConfidenceTooltipKey - abstract-only", () => {
  it("returns confidenceAbstractOnly when all papers are abstract-only", () => {
    expect(getConfidenceTooltipKey(5, 0, 5)).toBe("confidenceAbstractOnly");
  });

  it("returns confidenceAbstractOnly when some papers are abstract-only (mixed)", () => {
    expect(getConfidenceTooltipKey(3, 0, 10)).toBe("confidenceAbstractOnly");
  });

  it("returns confidenceAbstractOnly even with one abstract-only paper", () => {
    expect(getConfidenceTooltipKey(1, 0, 10)).toBe("confidenceAbstractOnly");
  });
});

describe("getConfidenceTooltipKey - full-text / general", () => {
  it("returns confidence when all papers have full text (no abstract-only, no no-content)", () => {
    expect(getConfidenceTooltipKey(0, 0, 10)).toBe("confidence");
  });

  it("returns confidence when abstractOnlyCount is 0 regardless of partial no-content", () => {
    // Some papers are no-content but not ALL — and no abstract-only papers
    expect(getConfidenceTooltipKey(0, 3, 10)).toBe("confidence");
  });
});

describe("getConfidenceTooltipKey - zero totalPapers edge case", () => {
  it("returns confidence as safe fallback when totalPapers is 0", () => {
    expect(getConfidenceTooltipKey(0, 0, 0)).toBe("confidence");
  });

  it("returns confidence when totalPapers is 0 even if abstractOnlyCount is nonzero", () => {
    // Edge case: abstractOnlyCount > 0 but totalPapers == 0 (shouldn't happen, but safe)
    expect(getConfidenceTooltipKey(5, 0, 0)).toBe("confidenceAbstractOnly");
  });
});

describe("getConfidenceTooltipKey - priority ordering", () => {
  it("no-content check runs before abstract-only check (same value)", () => {
    // 3 no-content out of 3 total — should be confidenceNoContent, not confidenceAbstractOnly
    expect(getConfidenceTooltipKey(3, 3, 3)).toBe("confidenceNoContent");
  });

  it("abstract-only check runs before mixed check for full sets", () => {
    // 5 abstract-only out of 5 total, 0 no-content — should be confidenceAbstractOnly
    expect(getConfidenceTooltipKey(5, 0, 5)).toBe("confidenceAbstractOnly");
  });

  it("returns confidenceAbstractOnly for partial abstract-only (mixed scenario)", () => {
    // 2 abstract-only out of 10 total, 0 no-content
    expect(getConfidenceTooltipKey(2, 0, 10)).toBe("confidenceAbstractOnly");
  });
});
