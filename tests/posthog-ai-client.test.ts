import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock posthog-js — factory must not reference outer variables (vi.mock is hoisted)
vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

// Mock ai-models
vi.mock("../lib/ai-models", () => ({
  getModelPricing: vi.fn().mockReturnValue({ input: 0, output: 0 }),
}));

const MOCK_UUID = "11111111-2222-3333-4444-555555555555";

import posthog from "posthog-js";
import { captureAIGeneration, captureAIGenerationBatch } from "../lib/posthog-ai";

const mockCapture = vi.mocked(posthog.capture);

/** Helper: extract properties from a capture call (non-null assertion safe in tests). */
function propsAt(callIndex: number): Record<string, unknown> {
  return mockCapture.mock.calls[callIndex][1] as Record<string, unknown>;
}

beforeEach(() => {
  mockCapture.mockClear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(MOCK_UUID as `${string}-${string}-${string}-${string}-${string}`);
});

// ═══════════════════════════════════════════════════════════════
// captureAIGeneration
// ═══════════════════════════════════════════════════════════════

describe("captureAIGeneration", () => {
  it("calls posthog.capture with $ai_generation event", () => {
    captureAIGeneration({
      provider: "openai",
      modelId: "gpt-4o",
      feature: "test_feature",
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 1000,
      input: "test",
      output: "result",
    });

    expect(mockCapture).toHaveBeenCalledOnce();
    expect(mockCapture).toHaveBeenCalledWith(
      "$ai_generation",
      expect.objectContaining({
        $ai_provider: "openai",
        $ai_model: "gpt-4o",
        feature: "test_feature",
        $ai_input_tokens: 100,
        $ai_output_tokens: 50,
        $ai_latency: 1.0,
      })
    );
  });

  it("passes temperature and httpStatus through to properties", () => {
    captureAIGeneration({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      feature: "screening",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 500,
      input: "p",
      output: "",
      isError: true,
      httpStatus: 429,
      errorCode: "AI_PROVIDER_ERROR",
      temperature: 0.1,
    });

    const props = propsAt(0);
    expect(props.$ai_http_status).toBe(429);
    expect(props.$ai_error_code).toBe("AI_PROVIDER_ERROR");
    expect(props.$ai_temperature).toBe(0.1);
    expect(props.$ai_is_error).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// captureAIGenerationBatch
// ═══════════════════════════════════════════════════════════════

describe("captureAIGenerationBatch", () => {
  it("does not call posthog.capture for empty entries", () => {
    captureAIGenerationBatch("openai", "gpt-4o", []);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("calls posthog.capture once per entry", () => {
    captureAIGenerationBatch("openai", "gpt-4o", [
      {
        feature: "screening",
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
        input: "paper 1",
        output: "result 1",
      },
      {
        feature: "screening",
        usage: { inputTokens: 200, outputTokens: 80 },
        latencyMs: 600,
        input: "paper 2",
        output: "result 2",
      },
    ]);

    expect(mockCapture).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenNthCalledWith(1, "$ai_generation", expect.any(Object));
    expect(mockCapture).toHaveBeenNthCalledWith(2, "$ai_generation", expect.any(Object));
  });

  it("all entries share the same trace ID", () => {
    captureAIGenerationBatch("openai", "gpt-4o", [
      {
        feature: "a",
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 10,
        input: "i1",
        output: "o1",
      },
      {
        feature: "b",
        usage: { inputTokens: 2, outputTokens: 2 },
        latencyMs: 20,
        input: "i2",
        output: "o2",
      },
    ]);

    const props1 = propsAt(0);
    const props2 = propsAt(1);

    expect(props1.$ai_trace_id).toBe(MOCK_UUID);
    expect(props2.$ai_trace_id).toBe(MOCK_UUID);
  });

  it("uses the provider and modelId passed to the batch function", () => {
    captureAIGenerationBatch("anthropic", "claude-sonnet-4-20250514", [
      {
        feature: "extraction",
        usage: { inputTokens: 500, outputTokens: 100 },
        latencyMs: 1000,
        input: "q",
        output: "a",
      },
    ]);

    const props = propsAt(0);
    expect(props.$ai_provider).toBe("anthropic");
    expect(props.$ai_model).toBe("claude-sonnet-4-20250514");
  });

  it("preserves per-entry feature names", () => {
    captureAIGenerationBatch("openai", "gpt-4o", [
      {
        feature: "extraction_question_pdf",
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
        input: "i",
        output: "o",
      },
      {
        feature: "extraction_question_abstract",
        usage: { inputTokens: 80, outputTokens: 40 },
        latencyMs: 300,
        input: "i2",
        output: "o2",
      },
    ]);

    expect(propsAt(0).feature).toBe("extraction_question_pdf");
    expect(propsAt(1).feature).toBe("extraction_question_abstract");
  });

  it("preserves per-entry usage, latency, and error fields", () => {
    captureAIGenerationBatch("openai", "gpt-4o", [
      {
        feature: "ok",
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
        input: "i",
        output: "o",
        temperature: 0.7,
      },
      {
        feature: "err",
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 100,
        input: "i",
        output: "",
        isError: true,
        httpStatus: 503,
        errorCode: "AI_PROVIDER_ERROR",
        errorMessage: "Down",
      },
    ]);

    const okProps = propsAt(0);
    expect(okProps.$ai_input_tokens).toBe(100);
    expect(okProps.$ai_latency).toBe(0.5);
    expect(okProps.$ai_temperature).toBe(0.7);
    expect(okProps.$ai_is_error).toBe(false);

    const errProps = propsAt(1);
    expect(errProps.$ai_input_tokens).toBe(0);
    expect(errProps.$ai_latency).toBe(0.1);
    expect(errProps.$ai_is_error).toBe(true);
    expect(errProps.$ai_http_status).toBe(503);
    expect(errProps.$ai_error_code).toBe("AI_PROVIDER_ERROR");
    expect(errProps.$ai_error).toBe("Down");
  });
});
