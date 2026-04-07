import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildAIGenerationProperties,
  truncateForTracking,
  extractHttpStatus,
  extractErrorCode,
  MAX_TRACKING_CONTENT_LENGTH,
  type AIGenerationParams,
} from "../lib/posthog-ai-shared";

// Stable UUID for deterministic tests
const MOCK_UUID = "00000000-1111-2222-3333-444444444444";

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(MOCK_UUID as `${string}-${string}-${string}-${string}-${string}`);
});

// ═══════════════════════════════════════════════════════════════
// truncateForTracking
// ═══════════════════════════════════════════════════════════════

describe("truncateForTracking", () => {
  it("returns short strings unchanged", () => {
    expect(truncateForTracking("hello")).toBe("hello");
  });

  it("returns empty string unchanged", () => {
    expect(truncateForTracking("")).toBe("");
  });

  it("returns string at exactly the limit unchanged", () => {
    const exact = "a".repeat(MAX_TRACKING_CONTENT_LENGTH);
    expect(truncateForTracking(exact)).toBe(exact);
  });

  it("truncates string one char over the limit", () => {
    const over = "a".repeat(MAX_TRACKING_CONTENT_LENGTH + 1);
    const result = truncateForTracking(over);
    expect(result).toBe("a".repeat(MAX_TRACKING_CONTENT_LENGTH) + "...[truncated]");
    expect(result.length).toBe(MAX_TRACKING_CONTENT_LENGTH + "...[truncated]".length);
  });

  it("truncates very long strings", () => {
    const long = "x".repeat(50_000);
    const result = truncateForTracking(long);
    expect(result.startsWith("x".repeat(MAX_TRACKING_CONTENT_LENGTH))).toBe(true);
    expect(result.endsWith("...[truncated]")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// extractHttpStatus
// ═══════════════════════════════════════════════════════════════

describe("extractHttpStatus", () => {
  it("returns undefined for null", () => {
    expect(extractHttpStatus(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });

  it("returns undefined for primitives", () => {
    expect(extractHttpStatus("error")).toBeUndefined();
    expect(extractHttpStatus(42)).toBeUndefined();
    expect(extractHttpStatus(true)).toBeUndefined();
  });

  it("returns undefined for plain Error without status", () => {
    expect(extractHttpStatus(new Error("fail"))).toBeUndefined();
  });

  it("extracts statusCode from top-level property", () => {
    expect(extractHttpStatus({ statusCode: 429 })).toBe(429);
  });

  it("extracts status from top-level property", () => {
    expect(extractHttpStatus({ status: 503 })).toBe(503);
  });

  it("prefers statusCode over status", () => {
    expect(extractHttpStatus({ statusCode: 429, status: 500 })).toBe(429);
  });

  it("extracts from cause.statusCode", () => {
    const error = { cause: { statusCode: 401 } };
    expect(extractHttpStatus(error)).toBe(401);
  });

  it("extracts from cause.status", () => {
    const error = { cause: { status: 502 } };
    expect(extractHttpStatus(error)).toBe(502);
  });

  it("extracts from data.statusCode", () => {
    const error = { data: { statusCode: 422 } };
    expect(extractHttpStatus(error)).toBe(422);
  });

  it("ignores non-number statusCode", () => {
    expect(extractHttpStatus({ statusCode: "429" })).toBeUndefined();
  });

  it("ignores non-object cause", () => {
    expect(extractHttpStatus({ cause: "string" })).toBeUndefined();
  });

  it("ignores non-object data", () => {
    expect(extractHttpStatus({ data: "string" })).toBeUndefined();
  });

  it("works with real Vercel AI SDK-style error shape", () => {
    const aiSdkError = Object.assign(new Error("Rate limited"), {
      statusCode: 429,
      cause: { statusCode: 429 },
    });
    expect(extractHttpStatus(aiSdkError)).toBe(429);
  });

  it("works with nested cause chain", () => {
    const nested = {
      message: "Wrapper",
      cause: {
        message: "Provider error",
        statusCode: 503,
      },
    };
    expect(extractHttpStatus(nested)).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════
// extractErrorCode
// ═══════════════════════════════════════════════════════════════

describe("extractErrorCode", () => {
  it("returns undefined for null", () => {
    expect(extractErrorCode(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(extractErrorCode(undefined)).toBeUndefined();
  });

  it("returns undefined for primitives", () => {
    expect(extractErrorCode("error")).toBeUndefined();
    expect(extractErrorCode(42)).toBeUndefined();
  });

  it("returns undefined for plain Error without code", () => {
    expect(extractErrorCode(new Error("fail"))).toBeUndefined();
  });

  it("extracts code from top-level property", () => {
    expect(extractErrorCode({ code: "AI_PROVIDER_ERROR" })).toBe("AI_PROVIDER_ERROR");
  });

  it("extracts code from data.code", () => {
    expect(extractErrorCode({ data: { code: "AI_INSUFFICIENT_CREDITS" } })).toBe(
      "AI_INSUFFICIENT_CREDITS"
    );
  });

  it("prefers top-level code over data.code", () => {
    expect(
      extractErrorCode({
        code: "TOP_LEVEL",
        data: { code: "NESTED" },
      })
    ).toBe("TOP_LEVEL");
  });

  it("ignores non-string code", () => {
    expect(extractErrorCode({ code: 123 })).toBeUndefined();
  });

  it("ignores non-object data", () => {
    expect(extractErrorCode({ data: "string" })).toBeUndefined();
  });

  it("works with Convex structured error shape", () => {
    const convexError = {
      message: "Insufficient credits",
      data: { code: "AI_INSUFFICIENT_CREDITS" },
    };
    expect(extractErrorCode(convexError)).toBe("AI_INSUFFICIENT_CREDITS");
  });

  it("works with AIError class shape", () => {
    const aiError = Object.assign(new Error("Provider error"), {
      code: "AI_PROVIDER_ERROR",
    });
    expect(extractErrorCode(aiError)).toBe("AI_PROVIDER_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════
// buildAIGenerationProperties
// ═══════════════════════════════════════════════════════════════

describe("buildAIGenerationProperties", () => {
  const baseParams: AIGenerationParams = {
    provider: "openai",
    modelId: "gpt-4o",
    feature: "enhance_search_query",
    usage: { inputTokens: 1000, outputTokens: 500 },
    latencyMs: 2500,
    input: "test input",
    output: "test output",
  };

  // ── Required fields ──────────────────────────────────────

  describe("required fields", () => {

    it("always includes $ai_trace_id", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_trace_id).toBe(MOCK_UUID);
    });

    it("always includes $ai_provider", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_provider).toBe("openai");
    });

    it("always includes $ai_model", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_model).toBe("gpt-4o");
    });

    it("always includes $ai_input_tokens and $ai_output_tokens", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_input_tokens).toBe(1000);
      expect(props.$ai_output_tokens).toBe(500);
    });

    it("always includes feature", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.feature).toBe("enhance_search_query");
    });

    it("formats $ai_input as message array", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_input).toEqual([{ role: "user", content: "test input" }]);
    });

    it("formats $ai_output_choices as message array", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_output_choices).toEqual([{ role: "assistant", content: "test output" }]);
    });
  });

  // ── Latency conversion ───────────────────────────────────

  describe("latency", () => {

    it("converts milliseconds to seconds", () => {
      const props = buildAIGenerationProperties({ ...baseParams, latencyMs: 2500 });
      expect(props.$ai_latency).toBe(2.5);
    });

    it("handles sub-second latency", () => {
      const props = buildAIGenerationProperties({ ...baseParams, latencyMs: 150 });
      expect(props.$ai_latency).toBe(0.15);
    });

    it("handles zero latency", () => {
      const props = buildAIGenerationProperties({ ...baseParams, latencyMs: 0 });
      expect(props.$ai_latency).toBe(0);
    });
  });

  // ── Token defaults ───────────────────────────────────────

  describe("token defaults", () => {

    it("defaults missing inputTokens to 0", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        usage: { outputTokens: 100 },
      });
      expect(props.$ai_input_tokens).toBe(0);
    });

    it("defaults missing outputTokens to 0", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        usage: { inputTokens: 100 },
      });
      expect(props.$ai_output_tokens).toBe(0);
    });

    it("defaults both to 0 when empty usage", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        usage: {},
      });
      expect(props.$ai_input_tokens).toBe(0);
      expect(props.$ai_output_tokens).toBe(0);
    });
  });

  // ── Fix 1: HTTP status ───────────────────────────────────

  describe("$ai_http_status (Fix 1)", () => {

    it("defaults to 200 for successful operations", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_http_status).toBe(200);
    });

    it("defaults to 500 for error operations when httpStatus not provided", () => {
      const props = buildAIGenerationProperties({ ...baseParams, isError: true });
      expect(props.$ai_http_status).toBe(500);
    });

    it("uses provided httpStatus over default 200", () => {
      const props = buildAIGenerationProperties({ ...baseParams, httpStatus: 201 });
      expect(props.$ai_http_status).toBe(201);
    });

    it("uses provided httpStatus for rate limit errors", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        httpStatus: 429,
      });
      expect(props.$ai_http_status).toBe(429);
    });

    it("uses provided httpStatus for service unavailable", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        httpStatus: 503,
      });
      expect(props.$ai_http_status).toBe(503);
    });
  });

  // ── Fix 3: Trace ID ──────────────────────────────────────

  describe("$ai_trace_id (Fix 3)", () => {

    it("auto-generates UUID when traceId not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_trace_id).toBe(MOCK_UUID);
    });

    it("uses provided traceId when given", () => {
      const customTraceId = "custom-trace-id-123";
      const props = buildAIGenerationProperties({
        ...baseParams,
        traceId: customTraceId,
      });
      expect(props.$ai_trace_id).toBe(customTraceId);
    });
  });

  // ── Fix 5: Temperature & maxTokens ───────────────────────

  describe("$ai_temperature and $ai_max_tokens (Fix 5)", () => {

    it("omits $ai_temperature when not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("$ai_temperature");
    });

    it("includes $ai_temperature when provided", () => {
      const props = buildAIGenerationProperties({ ...baseParams, temperature: 0.7 });
      expect(props.$ai_temperature).toBe(0.7);
    });

    it("includes $ai_temperature of 0", () => {
      const props = buildAIGenerationProperties({ ...baseParams, temperature: 0 });
      expect(props.$ai_temperature).toBe(0);
    });

    it("omits $ai_max_tokens when not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("$ai_max_tokens");
    });

    it("includes $ai_max_tokens when provided", () => {
      const props = buildAIGenerationProperties({ ...baseParams, maxTokens: 4096 });
      expect(props.$ai_max_tokens).toBe(4096);
    });
  });

  // ── Fix 6: Error code ────────────────────────────────────

  describe("$ai_error_code (Fix 6)", () => {

    it("omits $ai_error_code when not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("$ai_error_code");
    });

    it("includes $ai_error_code when provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        errorCode: "AI_PROVIDER_ERROR",
      });
      expect(props.$ai_error_code).toBe("AI_PROVIDER_ERROR");
    });

    it("omits $ai_error_code for empty string", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        errorCode: "",
      });
      expect(props).not.toHaveProperty("$ai_error_code");
    });
  });

  // ── Error state ──────────────────────────────────────────

  describe("error state", () => {

    it("defaults $ai_is_error to false", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_is_error).toBe(false);
    });

    it("sets $ai_is_error to true when isError is true", () => {
      const props = buildAIGenerationProperties({ ...baseParams, isError: true });
      expect(props.$ai_is_error).toBe(true);
    });

    it("includes $ai_error when errorMessage provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        errorMessage: "Rate limit exceeded",
      });
      expect(props.$ai_error).toBe("Rate limit exceeded");
    });

    it("omits $ai_error when no errorMessage", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("$ai_error");
    });

    it("omits $ai_error for empty errorMessage", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        errorMessage: "",
      });
      expect(props).not.toHaveProperty("$ai_error");
    });

    it("includes all error fields together for a full error event", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        isError: true,
        httpStatus: 429,
        errorCode: "AI_PROVIDER_ERROR",
        errorMessage: "Rate limit exceeded",
      });
      expect(props.$ai_is_error).toBe(true);
      expect(props.$ai_http_status).toBe(429);
      expect(props.$ai_error_code).toBe("AI_PROVIDER_ERROR");
      expect(props.$ai_error).toBe("Rate limit exceeded");
    });
  });

  // ── Metadata ─────────────────────────────────────────────

  describe("metadata", () => {

    it("spreads metadata into properties", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        metadata: { custom_key: "value", count: 42 },
      });
      expect(props.custom_key).toBe("value");
      expect(props.count).toBe(42);
    });

    it("handles empty metadata", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        metadata: {},
      });
      // Should not throw or add extra keys
      expect(props.$ai_provider).toBe("openai");
    });

    it("handles undefined metadata", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props.$ai_provider).toBe("openai");
    });
  });

  // ── Credit tracking ───────────────────────────────────────

  describe("credit tracking", () => {

    it("omits credit fields when not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("credits_deducted");
      expect(props).not.toHaveProperty("credits_remaining");
      expect(props).not.toHaveProperty("lifetime_credits_used");
    });

    it("includes credits_deducted when provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        creditsDeducted: 5,
      });
      expect(props.credits_deducted).toBe(5);
    });

    it("includes credits_remaining when provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        creditsRemaining: 95,
      });
      expect(props.credits_remaining).toBe(95);
    });

    it("includes lifetime_credits_used when provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        lifetimeCreditsUsed: 1500,
      });
      expect(props.lifetime_credits_used).toBe(1500);
    });

    it("includes credits_deducted of 0", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        creditsDeducted: 0,
      });
      expect(props.credits_deducted).toBe(0);
    });

    it("includes credits_raw_cost when provided", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        creditsRawCost: 2.7341,
      });
      expect(props.credits_raw_cost).toBe(2.7341);
    });

    it("omits credits_raw_cost when not provided", () => {
      const props = buildAIGenerationProperties(baseParams);
      expect(props).not.toHaveProperty("credits_raw_cost");
    });

    it("includes all credit fields together", () => {
      const props = buildAIGenerationProperties({
        ...baseParams,
        creditsDeducted: 3,
        creditsRawCost: 2.7341,
        creditsRemaining: 47,
        lifetimeCreditsUsed: 253,
      });
      expect(props.credits_deducted).toBe(3);
      expect(props.credits_raw_cost).toBe(2.7341);
      expect(props.credits_remaining).toBe(47);
      expect(props.lifetime_credits_used).toBe(253);
    });
  });

  // ── Full integration snapshot ────────────────────────────

  describe("integration", () => {
    it("produces complete event for a successful generation with all fields", () => {
      const traceId = "shared-trace-abc";

      const props = buildAIGenerationProperties({
        provider: "openai",
        modelId: "gpt-4o",
        feature: "screening",
        usage: { inputTokens: 500, outputTokens: 200 },
        latencyMs: 1234,
        input: "screen this paper",
        output: '{"responses": {}}',
        traceId,
        temperature: 0.1,
        maxTokens: 2048,
        creditsDeducted: 3,
        creditsRawCost: 2.7341,
        creditsRemaining: 97,
        lifetimeCreditsUsed: 503,
        metadata: { paperId: "abc123" },
      });

      expect(props).toEqual({
        $ai_trace_id: traceId,
        $ai_provider: "openai",
        $ai_model: "gpt-4o",
        $ai_input_tokens: 500,
        $ai_output_tokens: 200,
        $ai_latency: 1.234,
        $ai_is_error: false,
        $ai_http_status: 200,
        $ai_input: [{ role: "user", content: "screen this paper" }],
        $ai_output_choices: [{ role: "assistant", content: '{"responses": {}}' }],
        feature: "screening",
        $ai_temperature: 0.1,
        $ai_max_tokens: 2048,
        credits_deducted: 3,
        credits_raw_cost: 2.7341,
        credits_remaining: 97,
        lifetime_credits_used: 503,
        paperId: "abc123",
      });
    });

    it("produces complete event for a failed generation with all error fields", () => {
      const props = buildAIGenerationProperties({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        feature: "extraction",
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 500,
        input: "extract data",
        output: "",
        isError: true,
        httpStatus: 429,
        errorCode: "AI_PROVIDER_ERROR",
        errorMessage: "Rate limit exceeded",
        temperature: 0,
      });

      expect(props.$ai_is_error).toBe(true);
      expect(props.$ai_http_status).toBe(429);
      expect(props.$ai_error_code).toBe("AI_PROVIDER_ERROR");
      expect(props.$ai_error).toBe("Rate limit exceeded");
      expect(props.$ai_temperature).toBe(0);
    });
  });
});
