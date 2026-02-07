import { describe, expect, it } from "vitest";
import { buildEnhancedExtractionPrompt } from "../convex/extraction/prompts";

describe("buildEnhancedExtractionPrompt", () => {
  it("emits abstract-only instructions when no evidence is provided", () => {
    const prompt = buildEnhancedExtractionPrompt(
      {
        key: "sample_size",
        question: "What is the sample size?",
        type: "number",
      },
      "This review retained 273 studies after screening.",
      []
    );

    expect(prompt).toContain("ABSTRACT-ONLY mode");
    expect(prompt).toContain("supportEvidenceIds");
    expect(prompt).toContain("must always be []");
  });

  it("emits evidence-id citation instructions when evidence is provided", () => {
    const prompt = buildEnhancedExtractionPrompt(
      {
        key: "sample_size",
        question: "What is the sample size?",
        type: "number",
      },
      "This review retained 273 studies after screening.",
      [
        {
          evidenceId: "ev_2_100_220_abc123",
          text: "In total, 273 studies were retained for inclusion in the assessment.",
          page: 2,
          charRange: [100, 220],
          section: "methods",
        },
      ]
    );

    expect(prompt).toContain("SOURCE EVIDENCE FROM THE FULL PAPER");
    expect(prompt).toContain("You may cite only evidence IDs listed above.");
    expect(prompt).toContain("[EVIDENCE ev_2_100_220_abc123]");
  });
});
