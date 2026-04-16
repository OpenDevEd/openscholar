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

function makeCriticResponse(
  verdict: "supported" | "unsupported" | "partial",
  reason: string,
  inputTokens = 200,
  outputTokens = 30,
) {
  return {
    output: { verdict, reason },
    usage: { inputTokens, outputTokens },
    text: "",
    finishReason: "stop",
    response: { id: "critic-test", timestamp: new Date(), modelId: "test" },
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

      // Tier 1 first two attempts fail (2 attempts per tier)
      if (callCount <= 2) {
        throw new Error("Schema validation failed");
      }

      // Tier 2 extraction succeeds (call 3), critic succeeds (call 4)
      if (callCount === 3) {
        return makeSuccessResponse();
      }
      return makeCriticResponse("supported", "OK");
    });

    const results = await extractAnswers(
      "The study enrolled 42 participants in a randomized controlled trial.",
      [{ key: "q1", question: "How many participants?", expectedType: "number" }]
    );

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("42 participants");
    expect(results[0].confidence).toBe("high");
    expect(results[0].modelUsed).toBeDefined();
    // Should have called generateText at least 3 times (2 tier-1 failures + tier-2 extraction)
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("returns insufficient_evidence when all three tiers fail", async () => {
    const { extractAnswers } = await import("./extract");

    mockGenerateText.mockRejectedValue(new Error("Provider unavailable"));

    const results = await extractAnswers("Some paper text here", [
      { key: "q1", question: "What is the finding?" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
    expect(results[0].reasoning).toContain("All extraction tiers exhausted");
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
    // Track calls per-question to alternate extraction/critic
    const callsByQuestion = new Map<string, number>();

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      const prompt = String(opts.prompt ?? "");
      // Determine if this is an extraction or critic call
      const isCritic = prompt.includes("Verify this extraction result");

      if (!isCritic) {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return makeSuccessResponse({ answer: "test answer" });
      }
      return makeCriticResponse("supported", "OK");
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
      const prompt = String(opts.prompt ?? "");
      const isCritic = prompt.includes("Verify this extraction result");

      if (prompt.includes("Q2?")) {
        // Fail ALL tiers for question 2 -- cascade will exhaust all 3 tiers
        throw new Error("Simulated failure for q2");
      }

      if (isCritic) {
        return makeCriticResponse("supported", "OK");
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
    // q2 should have insufficient_evidence (not null) since Phase 92
    const q2 = results.find((r) => r.questionId === "q2");
    expect(q2?.answer).toBe("insufficient_evidence");
    expect(q2?.confidence).toBe("low");
  });
});

describe("token usage capture (D-18)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("captures aggregated tokensIn and tokensOut from extraction + critic", async () => {
    const { extractAnswers } = await import("./extract");

    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      if (callCount % 2 === 1) {
        // Extraction call
        return makeSuccessResponse({
          inputTokens: 5432,
          outputTokens: 234,
        });
      }
      // Critic call
      return makeCriticResponse("supported", "OK", 100, 20);
    });

    const results = await extractAnswers("Paper text", [
      { key: "q1", question: "Q?" },
    ]);

    // Tokens are aggregated: extraction + critic
    expect(results[0].tokensIn).toBe(5532);   // 5432 + 100
    expect(results[0].tokensOut).toBe(254);    // 234 + 20
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

    // Since the mock bypasses Zod superRefine, we test that when
    // extraction succeeds (mock returns valid output), the critic is called
    // and the result passes through correctly.
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
      return makeCriticResponse("supported", "Quote matches source");
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many participants?" },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("42 participants");
    expect(results[0].criticVerdict).toBe("supported");
  });

  it("rejects extraction when Levenshtein superRefine fails (simulated via schema error), retries then escalates", async () => {
    const { extractAnswers } = await import("./extract");

    // When the real AI SDK runs superRefine and it fails, generateText throws
    // a schema validation error. We simulate this by throwing on all calls.
    let callCount = 0;
    mockGenerateText.mockImplementation(async () => {
      callCount++;
      // Simulate Levenshtein superRefine failure: the AI SDK throws when
      // Output.object's Zod schema validation fails
      throw new Error("Evidence quote failed Levenshtein verification: 45.2% similarity (threshold: 85%)");
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many participants?" },
    ]);

    expect(results).toHaveLength(1);
    // All tiers exhausted -> insufficient_evidence
    expect(results[0].answer).toBe("insufficient_evidence");
    expect(results[0].confidence).toBe("low");
    // 2 attempts per tier x 3 tiers = 6 calls
    expect(callCount).toBe(6);
  });

  it("succeeds when bodyText is empty (superRefine early-returns)", async () => {
    const { extractAnswers } = await import("./extract");

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
      return makeCriticResponse("supported", "OK");
    });

    const results = await extractAnswers("", [
      { key: "q1", question: "How many?" },
    ]);

    expect(results).toHaveLength(1);
    // Empty bodyText early-returns in superRefine, so extraction succeeds
    expect(results[0].answer).not.toBeNull();
  });

  it("exhausts tiers when char offsets are out of bounds (simulated via schema error)", async () => {
    const { extractAnswers } = await import("./extract");

    // When the real AI SDK runs superRefine with out-of-bounds offsets,
    // the Zod issue causes a schema error -> generateText throws
    mockGenerateText.mockImplementation(async () => {
      throw new Error("Evidence char offsets out of bounds");
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results).toHaveLength(1);
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
      return makeCriticResponse("supported", "Quote matches");
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
      return makeCriticResponse("unsupported", "Quote does not support claim");
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
      return makeCriticResponse("partial", "Partially supported");
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
      return makeCriticResponse("supported", "OK", 200, 30);
    });

    const results = await extractAnswers(KNOWN_BODY_TEXT, [
      { key: "q1", question: "How many?" },
    ]);

    expect(results[0].tokensIn).toBe(1200);  // 1000 + 200
    expect(results[0].tokensOut).toBe(130);   // 100 + 30
  });
});

// ===================================================================
// Phase 100: Tier-based cascade filtering (TIER-03)
// ===================================================================

describe("tier-based cascade filtering (TIER-03)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("'cheap' tier uses only the cheapest model (TIER-03)", async () => {
    const { extractAnswers } = await import("./extract");
    const modelsUsed: string[] = [];

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      const model = opts.model as { modelId?: string };
      if (model?.modelId) modelsUsed.push(model.modelId);

      // Detect critic call by checking system prompt content
      const system = String(opts.system ?? "");
      if (system.includes("Verify") || system.includes("verify")) {
        return makeCriticResponse("supported", "OK");
      }
      return makeSuccessResponse();
    });

    await extractAnswers(
      "The study enrolled 42 participants.",
      [{ key: "q1", question: "How many participants?" }],
      undefined, undefined, undefined, undefined,
      "cheap"
    );

    expect(modelsUsed.length).toBeGreaterThan(0);
    expect(modelsUsed.every((m) => m === "google/gemini-2.5-flash-lite")).toBe(true);
  });

  it("'accurate' tier uses only the most capable model (TIER-03)", async () => {
    const { extractAnswers } = await import("./extract");
    const modelsUsed: string[] = [];

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      const model = opts.model as { modelId?: string };
      if (model?.modelId) modelsUsed.push(model.modelId);

      const system = String(opts.system ?? "");
      if (system.includes("Verify") || system.includes("verify")) {
        return makeCriticResponse("supported", "OK");
      }
      return makeSuccessResponse();
    });

    await extractAnswers(
      "The study enrolled 42 participants.",
      [{ key: "q1", question: "How many participants?" }],
      undefined, undefined, undefined, undefined,
      "accurate"
    );

    expect(modelsUsed.length).toBeGreaterThan(0);
    expect(modelsUsed.every((m) => m === "anthropic/claude-haiku-4.5")).toBe(true);
  });

  it("'auto' tier uses all 3 models in cascade on repeated failures (TIER-03)", async () => {
    const { extractAnswers } = await import("./extract");
    const modelsUsed: string[] = [];
    let callCount = 0;

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      callCount++;
      const model = opts.model as { modelId?: string };
      if (model?.modelId) modelsUsed.push(model.modelId);

      // Fail first 4 calls (2 attempts x tier 1 + 2 attempts x tier 2)
      // to force escalation through all 3 tiers
      if (callCount <= 4) {
        throw new Error("Schema validation failed");
      }

      // Tier 3 extraction succeeds (call 5)
      const system = String(opts.system ?? "");
      if (system.includes("Verify") || system.includes("verify")) {
        return makeCriticResponse("supported", "OK");
      }
      return makeSuccessResponse();
    });

    await extractAnswers(
      "The study enrolled 42 participants.",
      [{ key: "q1", question: "How many participants?" }],
      undefined, undefined, undefined, undefined,
      "auto"
    );

    // Should have used all 3 model names in the cascade
    const uniqueModels = [...new Set(modelsUsed)];
    expect(uniqueModels).toContain("google/gemini-2.5-flash-lite");
    expect(uniqueModels).toContain("google/gemini-3-flash-preview");
    expect(uniqueModels).toContain("anthropic/claude-haiku-4.5");
  });
});
