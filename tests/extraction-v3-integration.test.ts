import { describe, expect, it } from "vitest";
import {
  applyAbstractOnlyPolicy,
  applyEvidencePolicy,
  isUsableAbstract,
  normalizeExtractionOutputForQuestion,
  validateSupportEvidenceIds,
} from "../convex/extraction/workpoolActions";

/**
 * Local replica of the non-exported RetrievalCandidate from workpoolActions.
 * Kept in sync manually; shape must match for validateSupportEvidenceIds / applyEvidencePolicy.
 */
type TestRetrievalCandidate = {
  unit: {
    evidenceId: string;
    page: number;
    charRange: [number, number];
    text: string;
    section?: string;
    tokens: string[];
    anchorConfidence: number;
    source: string;
  };
  denseScore?: number;
  lexicalScore?: number;
  fusedScore?: number;
  rerankScore?: number;
};

describe("V3.2 evidence policy", () => {
  const evidencePool: TestRetrievalCandidate[] = [
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
      evidencePool
    );
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "over 270 coded studies out of approximately 650 identified",
        confidence: 0.92,
        reasoning: "Directly supported by methods evidence.",
        supportEvidenceIds: ["ev_2_120_280_abc123"],
      },
      validated,
      fallbackCandidates: evidencePool,
    });

    expect(policy.citationStatus).toBe("grounded");
    expect(policy.strictNull).toBe(false);
    expect(policy.selectedCandidates).toHaveLength(1);
    expect(policy.selectedCandidates[0].unit.evidenceId).toBe("ev_2_120_280_abc123");
  });

  it("returns best_effort with fallback citations when model omits valid IDs", () => {
    const validated = validateSupportEvidenceIds(["unknown"], evidencePool);
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "over 270 coded studies",
        confidence: 0.9,
        reasoning: "Likely supported by nearby evidence.",
        supportEvidenceIds: [],
      },
      validated,
      fallbackCandidates: evidencePool,
    });

    expect(policy.citationStatus).toBe("best_effort");
    expect(policy.strictNull).toBe(false);
    expect(policy.answer).toBe("over 270 coded studies");
    expect(policy.selectedCandidates.length).toBeGreaterThan(0);
    expect(policy.confidence).toBeLessThanOrEqual(0.45);
  });

  it("returns insufficient_evidence only when no support and no fallback candidates exist", () => {
    const validated = validateSupportEvidenceIds(["unknown"], evidencePool);
    const policy = applyEvidencePolicy({
      extracted: {
        answer: "270",
        confidence: 0.7,
        reasoning: "Unsupported answer.",
        supportEvidenceIds: ["unknown"],
      },
      validated,
      fallbackCandidates: [],
    });

    expect(policy.citationStatus).toBe("insufficient_evidence");
    expect(policy.strictNull).toBe(true);
    expect(policy.answer).toBeNull();
    expect(policy.selectedCandidates).toHaveLength(0);
  });

  it("returns best_effort for abstract-only non-null answers with confidence capped", () => {
    const policy = applyAbstractOnlyPolicy({
      extracted: {
        answer: "273 studies",
        confidence: 0.94,
        reasoning: "Abstract states the number of retained studies.",
        supportEvidenceIds: [],
      },
      pdfEnabled: true,
    });

    expect(policy.citationStatus).toBe("best_effort");
    expect(policy.strictNull).toBe(false);
    expect(policy.answer).toBe("273 studies");
    expect(policy.confidence).toBeLessThanOrEqual(0.7);
  });

  it("returns insufficient_evidence for abstract-only null answers", () => {
    const policy = applyAbstractOnlyPolicy({
      extracted: {
        answer: null,
        confidence: 0.52,
        reasoning: "Abstract does not contain the requested metric.",
        supportEvidenceIds: [],
      },
      pdfEnabled: true,
    });

    expect(policy.citationStatus).toBe("insufficient_evidence");
    expect(policy.strictNull).toBe(true);
    expect(policy.answer).toBeNull();
  });

  it("treats abstracts shorter than threshold as unusable", () => {
    expect(isUsableAbstract(undefined)).toBe(false);
    expect(isUsableAbstract("short abstract")).toBe(false);
    expect(isUsableAbstract("a".repeat(80))).toBe(true);
  });

  it("normalizes array answers by deduping, splitting, and capping", () => {
    const normalized = normalizeExtractionOutputForQuestion("array", {
      answer: [
        "GPT-4; ChatGPT",
        "gpt-4",
        "Machine Learning",
        "GitHub Copilot",
        "CodeLlama",
        "Claude",
        "Gemini",
        "Bard",
        "StarCoder",
        "Mistral",
      ],
      confidence: 0.9,
      reasoning: "test",
      supportEvidenceIds: [],
    });

    expect(Array.isArray(normalized.answer)).toBe(true);
    expect((normalized.answer as string[]).length).toBeLessThanOrEqual(8);
    expect((normalized.answer as string[]).includes("gpt-4")).toBe(true);
    expect((normalized.answer as string[]).includes("chatgpt")).toBe(true);
  });

  it("reduces confidence when array answers are mostly generic terms", () => {
    const normalized = normalizeExtractionOutputForQuestion("array", {
      answer: [
        "Machine Learning",
        "Deep Learning",
        "Neural Networks",
        "Transformer Architecture",
        "GPT-4",
      ],
      confidence: 0.8,
      reasoning: "test",
      supportEvidenceIds: [],
    });

    expect(normalized.confidence).toBeLessThan(0.8);
    expect(normalized.confidence).toBeGreaterThanOrEqual(0);
  });
});
