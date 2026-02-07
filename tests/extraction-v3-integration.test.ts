import { describe, expect, it } from "vitest";
import {
  applyEvidencePolicy,
  validateSupportEvidenceIds,
} from "../convex/extraction/workpoolActions";

describe("V3.2 evidence policy", () => {
  const evidencePool = [
    {
      unit: {
        evidenceId: "ev_2_120_280_abc123",
        page: 2,
        charRange: [120, 280] as [number, number],
        text: "The assessment identified approximately 650 studies, of which over 270 were coded and analyzed.",
        section: "methods",
        tokens: ["assessment", "identified", "650", "studies", "270", "coded", "analyzed"],
        anchorConfidence: 1,
        source: "pdfjs_chunks",
      },
      denseScore: 0.72,
      lexicalScore: 1.46,
      fusedScore: 0.031,
    },
    {
      unit: {
        evidenceId: "ev_2_300_420_def456",
        page: 2,
        charRange: [300, 420] as [number, number],
        text: "The review focused on studies published since 2005 and included expert reports.",
        section: "methods",
        tokens: ["review", "studies", "published", "2005", "expert", "reports"],
        anchorConfidence: 1,
        source: "pdfjs_chunks",
      },
      denseScore: 0.55,
      lexicalScore: 1.02,
      fusedScore: 0.024,
    },
  ];

  it("returns grounded when valid support IDs are present", () => {
    const validated = validateSupportEvidenceIds(
      ["ev_2_120_280_abc123"],
      evidencePool as any
    );
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "over 270 coded studies out of approximately 650 identified",
        confidence: 0.92,
        reasoning: "Directly supported by methods evidence.",
        supportEvidenceIds: ["ev_2_120_280_abc123"],
      },
      validated: validated as any,
      fallbackCandidates: evidencePool as any,
    });

    expect(policy.citationStatus).toBe("grounded");
    expect(policy.strictNull).toBe(false);
    expect(policy.selectedCandidates).toHaveLength(1);
    expect(policy.selectedCandidates[0].unit.evidenceId).toBe("ev_2_120_280_abc123");
  });

  it("returns best_effort with fallback citations when model omits valid IDs", () => {
    const validated = validateSupportEvidenceIds(["unknown"], evidencePool as any);
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "over 270 coded studies",
        confidence: 0.9,
        reasoning: "Likely supported by nearby evidence.",
        supportEvidenceIds: [],
      },
      validated: validated as any,
      fallbackCandidates: evidencePool as any,
    });

    expect(policy.citationStatus).toBe("best_effort");
    expect(policy.strictNull).toBe(false);
    expect(policy.answer).toBe("over 270 coded studies");
    expect(policy.selectedCandidates.length).toBeGreaterThan(0);
    expect(policy.confidence).toBeLessThanOrEqual(0.45);
  });

  it("returns insufficient_evidence only when no support and no fallback candidates exist", () => {
    const validated = validateSupportEvidenceIds(["unknown"], evidencePool as any);
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "270",
        confidence: 0.7,
        reasoning: "Unsupported answer.",
        supportEvidenceIds: ["unknown"],
      },
      validated: validated as any,
      fallbackCandidates: [],
    });

    expect(policy.citationStatus).toBe("insufficient_evidence");
    expect(policy.strictNull).toBe(true);
    expect(policy.answer).toBeNull();
    expect(policy.selectedCandidates).toHaveLength(0);
  });
});
