import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfidenceTooltipKey } from "../lib/extraction/confidence-messages";

describe("getConfidenceTooltipKey (PDF enabled — default)", () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  });

  describe("no-content priority", () => {
    it("returns confidenceNoContent when all papers have no content", () => {
      expect(getConfidenceTooltipKey(0, 5, 5)).toBe("confidenceNoContent");
    });

    it("returns confidenceNoContent when noContentCount equals totalPapers (boundary)", () => {
      expect(getConfidenceTooltipKey(0, 1, 1)).toBe("confidenceNoContent");
    });

    it("prioritizes no-content over abstract-only when both are at totalPapers", () => {
      expect(getConfidenceTooltipKey(5, 5, 5)).toBe("confidenceNoContent");
    });
  });

  describe("abstract-only", () => {
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

  describe("full-text / general", () => {
    it("returns confidence when all papers have full text (no abstract-only, no no-content)", () => {
      expect(getConfidenceTooltipKey(0, 0, 10)).toBe("confidence");
    });

    it("returns confidence when abstractOnlyCount is 0 regardless of partial no-content", () => {
      expect(getConfidenceTooltipKey(0, 3, 10)).toBe("confidence");
    });
  });

  describe("zero totalPapers edge case", () => {
    it("returns confidence as safe fallback when totalPapers is 0", () => {
      expect(getConfidenceTooltipKey(0, 0, 0)).toBe("confidence");
    });

    it("returns confidenceAbstractOnly when totalPapers is 0 but abstractOnlyCount is nonzero", () => {
      expect(getConfidenceTooltipKey(5, 0, 0)).toBe("confidenceAbstractOnly");
    });
  });

  describe("priority ordering", () => {
    it("no-content check runs before abstract-only check (same value)", () => {
      expect(getConfidenceTooltipKey(3, 3, 3)).toBe("confidenceNoContent");
    });

    it("abstract-only check runs before mixed check for full sets", () => {
      expect(getConfidenceTooltipKey(5, 0, 5)).toBe("confidenceAbstractOnly");
    });

    it("returns confidenceAbstractOnly for partial abstract-only (mixed scenario)", () => {
      expect(getConfidenceTooltipKey(2, 0, 10)).toBe("confidenceAbstractOnly");
    });
  });
});

describe("getConfidenceTooltipKey (PDF disabled)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  });

  it("returns confidence even when all papers are abstract-only", () => {
    expect(getConfidenceTooltipKey(5, 0, 5)).toBe("confidence");
  });

  it("returns confidence even when some papers are abstract-only (mixed)", () => {
    expect(getConfidenceTooltipKey(3, 0, 10)).toBe("confidence");
  });

  it("returns confidence for a single abstract-only paper", () => {
    expect(getConfidenceTooltipKey(1, 0, 10)).toBe("confidence");
  });

  it("still returns confidenceNoContent when all papers have no content", () => {
    expect(getConfidenceTooltipKey(0, 5, 5)).toBe("confidenceNoContent");
  });

  it("returns confidence when no papers are abstract-only or no-content", () => {
    expect(getConfidenceTooltipKey(0, 0, 10)).toBe("confidence");
  });
});
