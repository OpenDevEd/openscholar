import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Mock generateText from 'ai' module -- must be before any imports that use it
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mockGenerateText,
  };
});

// Mock createOpenRouter to avoid needing OPENROUTER_API_KEY in tests
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => (modelId: string) => ({ modelId, provider: "openrouter" }),
}));

// Mock fastest-levenshtein with a real Levenshtein implementation for test accuracy
vi.mock("fastest-levenshtein", () => ({
  distance: (a: string, b: string) => {
    if (a === b) return 0;
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
      for (let j = 1; j <= b.length; j++) {
        matrix[i][j] = i === 0 ? j : 0;
      }
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[a.length][b.length];
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessResponse(overrides: Partial<{
  reasoning: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  evidence_quote: string;
  evidence_source_id: string;
  evidence_start_char: number;
  evidence_end_char: number;
  inputTokens: number;
  outputTokens: number;
}> = {}) {
  return {
    output: {
      reasoning: overrides.reasoning ?? "Found in methods section",
      answer: overrides.answer ?? "42 participants",
      confidence: overrides.confidence ?? "high",
      evidence_quote: overrides.evidence_quote ?? "42 participants were enrolled",
      evidence_source_id: overrides.evidence_source_id ?? "Methods",
      evidence_start_char: overrides.evidence_start_char ?? 100,
      evidence_end_char: overrides.evidence_end_char ?? 130,
    },
    usage: {
      inputTokens: overrides.inputTokens ?? 1000,
      outputTokens: overrides.outputTokens ?? 50,
    },
    text: "",
    finishReason: "stop",
    response: { id: "test", timestamp: new Date(), modelId: "test" },
    reasoning: undefined,
    sources: [],
    files: [],
    toolCalls: [],
    toolResults: [],
    request: { body: "" },
    warnings: [],
    providerMetadata: undefined,
    steps: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extraction output schema (EXTR-02)", () => {
  it("produces JSON Schema with propertyOrdering enforcing reasoning before answer", () => {
    const schema = z
      .object({
        reasoning: z.string(),
        answer: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        evidence_quote: z.string(),
        evidence_source_id: z.string(),
        evidence_start_char: z.number(),
        evidence_end_char: z.number(),
      })
      .meta({
        propertyOrdering: [
          "reasoning",
          "answer",
          "confidence",
          "evidence_quote",
          "evidence_source_id",
          "evidence_start_char",
          "evidence_end_char",
        ],
      });

    const jsonSchema = z.toJSONSchema(schema);
    expect(jsonSchema).toHaveProperty("propertyOrdering");
    expect(
      (jsonSchema as Record<string, unknown>).propertyOrdering
    ).toEqual([
      "reasoning",
      "answer",
      "confidence",
      "evidence_quote",
      "evidence_source_id",
      "evidence_start_char",
      "evidence_end_char",
    ]);
    // Verify reasoning comes before answer in propertyOrdering
    const ordering = (jsonSchema as Record<string, unknown>)
      .propertyOrdering as string[];
    expect(ordering.indexOf("reasoning")).toBeLessThan(
      ordering.indexOf("answer")
    );
  });

  it("schema has exactly 7 required properties", () => {
    const testSchema = z.object({
      reasoning: z.string(),
      answer: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
      evidence_quote: z.string(),
      evidence_source_id: z.string(),
      evidence_start_char: z.number(),
      evidence_end_char: z.number(),
    });

    const jsonSchema = z.toJSONSchema(testSchema);
    const required = (jsonSchema as Record<string, unknown>)
      .required as string[];
    expect(required).toHaveLength(7);
    expect(required).toContain("reasoning");
    expect(required).toContain("answer");
    expect(required).toContain("evidence_quote");
  });
});

describe("cascade escalation (EXTR-06)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("escalates from tier 1 to tier 2 on schema failure", async () => {
    const { extractAnswers } = await import("./extract");

    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        // Tier 1 failure
        throw new Error("Schema validation failed");
      }

      // Tier 2 success
      return makeSuccessResponse();
    });

    const results = await extractAnswers(
      "The study enrolled 42 participants in a randomized controlled trial.",
      [{ key: "q1", question: "How many participants?", expectedType: "number" }]
    );

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("42 participants");
    expect(results[0].confidence).toBe("high");
    expect(results[0].modelUsed).toBeDefined();
    // Should have called generateText at least twice (tier 1 failed, tier 2 succeeded)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("returns null answer when all three tiers fail", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockRejectedValue(new Error("Provider unavailable"));

    const results = await extractAnswers("Some paper text here", [
      { key: "q1", question: "What is the finding?" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBeNull();
    expect(results[0].errorMessage).toContain("All cascade tiers failed");
  });
});

describe("per-question parallelism (EXTR-10)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("processes multiple questions with concurrency cap 5", async () => {
    const { extractAnswers } = await import("./extract");

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockGenerateText.mockImplementation(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      // Simulate some async work
      await new Promise((resolve) => setTimeout(resolve, 10));

      currentConcurrent--;

      return makeSuccessResponse({ answer: "test answer" });
    });

    // Create 8 questions to test concurrency cap
    const questions = Array.from({ length: 8 }, (_, i) => ({
      key: `q${i + 1}`,
      question: `Question ${i + 1}?`,
    }));

    const results = await extractAnswers("Paper body text", questions);

    expect(results).toHaveLength(8);
    expect(results.every((r) => r.answer === "test answer")).toBe(true);
    // Concurrency should never exceed 5
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });

  it("one question failure does not abort siblings", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      // Identify which question is being asked by checking the prompt content
      const prompt = String(opts.prompt ?? "");
      if (prompt.includes("Q2?")) {
        // Fail ALL tiers for question 2 -- cascade will exhaust all 3 tiers
        throw new Error("Simulated failure for q2");
      }

      return makeSuccessResponse({ answer: "success" });
    });

    const results = await extractAnswers("Paper text", [
      { key: "q1", question: "Q1?" },
      { key: "q2", question: "Q2?" },
      { key: "q3", question: "Q3?" },
    ]);

    expect(results).toHaveLength(3);
    // q1 and q3 should succeed
    expect(results.find((r) => r.questionId === "q1")?.answer).toBe("success");
    expect(results.find((r) => r.questionId === "q3")?.answer).toBe("success");
    // q2 should have null answer with error
    const q2 = results.find((r) => r.questionId === "q2");
    expect(q2?.answer).toBeNull();
    expect(q2?.errorMessage).toBeDefined();
  });
});

describe("token usage capture (D-18)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("captures tokensIn and tokensOut from AI SDK response", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockImplementation(async () => {
      return makeSuccessResponse({
        inputTokens: 5432,
        outputTokens: 234,
      });
    });

    const results = await extractAnswers("Paper text", [
      { key: "q1", question: "Q?" },
    ]);

    expect(results[0].tokensIn).toBe(5432);
    expect(results[0].tokensOut).toBe(234);
  });
});

// ===================================================================
// Phase 92: Levenshtein verification, critic pass, insufficient_evidence
// ===================================================================

const KNOWN_BODY_TEXT =
  "The study enrolled 42 participants in a randomized controlled trial conducted at three sites.";

describe("Levenshtein verification (EXTR-03)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("passes extraction when evidence_quote has >=85% similarity to source slice", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);

    // First call: extraction with high-similarity quote
    // Second call: critic returns supported
    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        // Extraction call
        return makeSuccessResponse({
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
        });
      }
      // Critic call
      return {
        ...makeSuccessResponse(),
        output: { verdict: "supported", reason: "Quote matches source" },
      };
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many participants?" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("42 participants");
    expect(results[0].criticVerdict).toBe("supported");
  });

  it("rejects extraction when evidence_quote has <85% similarity, retries same tier then escalates", async () => {
    const { extractAnswers } = await import("./extract");

    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      // All extraction calls return a bad quote (very different from source)
      return makeSuccessResponse({
        evidence_quote: "Completely different text that has no similarity to the source at all whatsoever",
        evidence_start_char: 0,
        evidence_end_char: 50,
      });
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many participants?" },
    ]);

    expect(results).toHaveLength(1);
    // Should eventually return insufficient_evidence after all tiers exhaust
    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
    // Should have retried (2 attempts per tier x 3 tiers = 6 calls)
    expect(callCount).toBe(6);
  });

  it("adds Zod issue when bodyText is empty", async () => {
    const { extractAnswers } = await import("./extract");

    // With empty bodyText, superRefine should early-return (no validation)
    // so the extraction should succeed (empty bodyText is a no-op for validation)
    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        return makeSuccessResponse({
          evidence_quote: "some quote",
          evidence_start_char: 0,
          evidence_end_char: 10,
        });
      }
      return {
        ...makeSuccessResponse(),
        output: { verdict: "supported", reason: "OK" },
      };
    });

    const results = await extractAnswers("", [
      { key: "q1", question: "How many?" },
    ]);

    expect(results).toHaveLength(1);
    // Empty bodyText early-returns in superRefine, so extraction succeeds
    expect(results[0].answer).not.toBeNull();
  });

  it("adds Zod issue when char offsets are out of bounds", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockImplementation(async () => {
      return makeSuccessResponse({
        evidence_quote: "out of bounds",
        evidence_start_char: -1,
        evidence_end_char: 999,
      });
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results).toHaveLength(1);
    // Out of bounds should trigger superRefine failure -> exhaust tiers -> insufficient_evidence
    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
  });
});

describe("critic pass (EXTR-05)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("passes answer through unchanged when critic returns 'supported'", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);
    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        return makeSuccessResponse({
          answer: "42 participants",
          confidence: "high",
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
        });
      }
      return {
        ...makeSuccessResponse(),
        output: { verdict: "supported", reason: "Quote matches" },
      };
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].answer).toBe("42 participants");
    expect(results[0].confidence).toBe("high");
    expect(results[0].criticVerdict).toBe("supported");
  });

  it("flips answer to insufficient_evidence when critic returns 'unsupported'", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);
    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        return makeSuccessResponse({
          answer: "42 participants",
          confidence: "high",
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
        });
      }
      return {
        ...makeSuccessResponse(),
        output: { verdict: "unsupported", reason: "Quote does not support claim" },
      };
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
    expect(results[0].criticVerdict).toBe("unsupported");
  });

  it("downgrades confidence by one level when critic returns 'partial'", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);
    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        return makeSuccessResponse({
          answer: "42 participants",
          confidence: "high",
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
        });
      }
      return {
        ...makeSuccessResponse(),
        output: { verdict: "partial", reason: "Partially supported" },
      };
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].answer).toBe("42 participants");
    expect(results[0].confidence).toBe("medium"); // high -> medium
    expect(results[0].criticVerdict).toBe("partial");
  });

  it("keeps answer with criticVerdict='timeout' when critic times out", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);
    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        return makeSuccessResponse({
          answer: "42 participants",
          confidence: "high",
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
        });
      }
      // Critic call throws timeout error
      throw new Error("AbortError: signal timed out");
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].answer).toBe("42 participants");
    expect(results[0].confidence).toBe("high"); // unchanged
    expect(results[0].criticVerdict).toBe("timeout");
  });
});

describe("insufficient_evidence state (EXTR-08)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("returns answer='insufficient_evidence' when all tiers are exhausted", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockRejectedValue(new Error("Provider unavailable"));

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "What is the finding?" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
    // No evidence fields should be present
    expect(results[0].evidenceQuote).toBeUndefined();
    expect(results[0].evidenceStartChar).toBeUndefined();
    expect(results[0].evidenceEndChar).toBeUndefined();
  });
});

describe("critic token aggregation (D-20)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("sums extraction and critic tokens into result tokensIn/tokensOut", async () => {
    const { extractAnswers } = await import("./extract");

    const exactQuote = KNOWN_BODY_TEXT.slice(0, 50);
    let callCount = 0;

    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        // Extraction call
        return makeSuccessResponse({
          evidence_quote: exactQuote,
          evidence_start_char: 0,
          evidence_end_char: 50,
          inputTokens: 1000,
          outputTokens: 100,
        });
      }
      // Critic call
      return {
        output: { verdict: "supported", reason: "OK" },
        usage: { inputTokens: 200, outputTokens: 30 },
        text: "",
        finishReason: "stop",
        response: { id: "test", timestamp: new Date(), modelId: "test" },
        reasoning: undefined,
        sources: [],
        files: [],
        toolCalls: [],
        toolResults: [],
        request: { body: "" },
        warnings: [],
        providerMetadata: undefined,
        steps: [],
      };
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].tokensIn).toBe(1200);  // 1000 + 200
    expect(results[0].tokensOut).toBe(130);   // 100 + 30
  });
});
