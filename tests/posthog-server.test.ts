import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
vi.mock("../lib/ai-models", () => ({
  getProviderConfig: vi.fn().mockReturnValue({ id: "openai", name: "OpenAI", apiKeyUrl: "", apiKeyPlaceholder: "" }),
  getDefaultModelForProvider: vi.fn().mockReturnValue("gpt-4o"),
}));

const MOCK_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const origRandomUUID = crypto.randomUUID;

import {
  captureAIGenerationServer,
  captureAIGenerationBatchServer,
} from "../lib/posthog-server";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));

function setEnv(key: string, val: string | undefined) {
  if (val === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = val;
  }
}

function clearPostHogEnv() {
  setEnv("POSTHOG_KEY", undefined);
  setEnv("NEXT_PUBLIC_POSTHOG_KEY", undefined);
  setEnv("POSTHOG_HOST", undefined);
  setEnv("NEXT_PUBLIC_POSTHOG_HOST", undefined);
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(MOCK_UUID as `${string}-${string}-${string}-${string}-${string}`);
  mockFetch.mockClear();
  clearPostHogEnv();
});

afterEach(() => {
  clearPostHogEnv();
  crypto.randomUUID = origRandomUUID;
});

// ═══════════════════════════════════════════════════════════════
// captureAIGenerationServer
// ═══════════════════════════════════════════════════════════════

describe("captureAIGenerationServer", () => {
  it("does not call fetch when no PostHog key is set", async () => {
    await captureAIGenerationServer({
      distinctId: "user_123",
      provider: "openai",
      modelId: "gpt-4o",
      feature: "test",
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 100,
      input: "hi",
      output: "hello",
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends event via fetch when POSTHOG_KEY is set", async () => {
    setEnv("POSTHOG_KEY", "phc_test123");

    await captureAIGenerationServer({
      distinctId: "user_456",
      provider: "openai",
      modelId: "gpt-4o",
      feature: "screening",
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 2000,
      input: "test input",
      output: "test output",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(options.body);
    expect(body.api_key).toBe("phc_test123");
    expect(body.event).toBe("$ai_generation");
    expect(body.distinct_id).toBe("user_456");
    expect(body.properties.$ai_provider).toBe("openai");
    expect(body.properties.$ai_model).toBe("gpt-4o");
    expect(body.properties.feature).toBe("screening");
  });

  it("uses NEXT_PUBLIC_POSTHOG_KEY as fallback", async () => {
    setEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_public");

    await captureAIGenerationServer({
      distinctId: "user_1",
      provider: "openai",
      modelId: "gpt-4o",
      feature: "test",
      usage: {},
      latencyMs: 0,
      input: "",
      output: "",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.api_key).toBe("phc_public");
  });

  it("uses custom POSTHOG_HOST", async () => {
    setEnv("POSTHOG_KEY", "phc_test");
    setEnv("POSTHOG_HOST", "https://custom.posthog.example.com");

    await captureAIGenerationServer({
      distinctId: "u",
      provider: "openai",
      modelId: "m",
      feature: "f",
      usage: {},
      latencyMs: 0,
      input: "",
      output: "",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://custom.posthog.example.com/i/v0/e/");
  });

  it("prepends https:// to host without protocol", async () => {
    setEnv("POSTHOG_KEY", "phc_test");
    setEnv("POSTHOG_HOST", "my.posthog.host");

    await captureAIGenerationServer({
      distinctId: "u",
      provider: "openai",
      modelId: "m",
      feature: "f",
      usage: {},
      latencyMs: 0,
      input: "",
      output: "",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://my.posthog.host/i/v0/e/");
  });

  it("does not throw when fetch fails (fire-and-forget)", async () => {
    setEnv("POSTHOG_KEY", "phc_test");
    mockFetch.mockRejectedValueOnce(new Error("Network down"));

    await expect(
      captureAIGenerationServer({
        distinctId: "u",
        provider: "openai",
        modelId: "m",
        feature: "f",
        usage: {},
        latencyMs: 0,
        input: "",
        output: "",
      })
    ).resolves.toBeUndefined();
  });

  it("passes through new fields (httpStatus, errorCode, temperature)", async () => {
    setEnv("POSTHOG_KEY", "phc_test");

    await captureAIGenerationServer({
      distinctId: "user_x",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      feature: "extraction",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 100,
      input: "prompt",
      output: "",
      isError: true,
      httpStatus: 429,
      errorCode: "AI_PROVIDER_ERROR",
      errorMessage: "Rate limited",
      temperature: 0.3,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.properties.$ai_http_status).toBe(429);
    expect(body.properties.$ai_error_code).toBe("AI_PROVIDER_ERROR");
    expect(body.properties.$ai_error).toBe("Rate limited");
    expect(body.properties.$ai_temperature).toBe(0.3);
    expect(body.properties.$ai_is_error).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// captureAIGenerationBatchServer
// ═══════════════════════════════════════════════════════════════

describe("captureAIGenerationBatchServer", () => {
  it("does not call fetch when no PostHog key is set", async () => {
    await captureAIGenerationBatchServer("user_1", "openai", "gpt-4o", [
      {
        feature: "screening",
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
        input: "input1",
        output: "output1",
      },
    ]);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call fetch for empty entries array", async () => {
    setEnv("POSTHOG_KEY", "phc_test");
    await captureAIGenerationBatchServer("user_1", "openai", "gpt-4o", []);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends one fetch call per entry", async () => {
    setEnv("POSTHOG_KEY", "phc_batch");

    await captureAIGenerationBatchServer("user_batch", "openai", "gpt-4o", [
      {
        feature: "screening",
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 500,
        input: "paper 1",
        output: "result 1",
        temperature: 0.1,
      },
      {
        feature: "screening",
        usage: { inputTokens: 200, outputTokens: 80 },
        latencyMs: 600,
        input: "paper 2",
        output: "result 2",
        temperature: 0.1,
      },
      {
        feature: "screening",
        usage: { inputTokens: 150, outputTokens: 60 },
        latencyMs: 450,
        input: "paper 3",
        output: "result 3",
        temperature: 0.1,
      },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("all entries in a batch share the same trace ID", async () => {
    setEnv("POSTHOG_KEY", "phc_batch");

    await captureAIGenerationBatchServer("user_1", "openai", "gpt-4o", [
      {
        feature: "a",
        usage: { inputTokens: 10, outputTokens: 5 },
        latencyMs: 100,
        input: "i1",
        output: "o1",
      },
      {
        feature: "b",
        usage: { inputTokens: 20, outputTokens: 10 },
        latencyMs: 200,
        input: "i2",
        output: "o2",
      },
    ]);

    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);

    expect(body1.properties.$ai_trace_id).toBe(MOCK_UUID);
    expect(body2.properties.$ai_trace_id).toBe(MOCK_UUID);
    expect(body1.properties.$ai_trace_id).toBe(body2.properties.$ai_trace_id);
  });

  it("each entry gets correct distinct_id and provider/model", async () => {
    setEnv("POSTHOG_KEY", "phc_batch");

    await captureAIGenerationBatchServer("user_abc", "anthropic", "claude-sonnet-4-20250514", [
      {
        feature: "extraction",
        usage: { inputTokens: 500, outputTokens: 100 },
        latencyMs: 1000,
        input: "question 1",
        output: "answer 1",
      },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.distinct_id).toBe("user_abc");
    expect(body.event).toBe("$ai_generation");
    expect(body.properties.$ai_provider).toBe("anthropic");
    expect(body.properties.$ai_model).toBe("claude-sonnet-4-20250514");
    expect(body.properties.feature).toBe("extraction");
    expect(body.properties.$ai_input_tokens).toBe(500);
    expect(body.properties.$ai_output_tokens).toBe(100);
    expect(body.properties.$ai_latency).toBe(1.0);
  });

  it("does not throw when individual fetch calls fail", async () => {
    setEnv("POSTHOG_KEY", "phc_batch");
    mockFetch
      .mockResolvedValueOnce(new Response("ok"))
      .mockRejectedValueOnce(new Error("Network"))
      .mockResolvedValueOnce(new Response("ok"));

    await expect(
      captureAIGenerationBatchServer("u", "openai", "m", [
        { feature: "a", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, input: "", output: "" },
        { feature: "b", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, input: "", output: "" },
        { feature: "c", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, input: "", output: "" },
      ])
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("propagates per-entry error fields correctly", async () => {
    setEnv("POSTHOG_KEY", "phc_batch");

    await captureAIGenerationBatchServer("u", "openai", "gpt-4o", [
      {
        feature: "screening",
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 100,
        input: "prompt",
        output: "",
        isError: true,
        httpStatus: 503,
        errorCode: "AI_PROVIDER_ERROR",
        errorMessage: "Service unavailable",
      },
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.properties.$ai_is_error).toBe(true);
    expect(body.properties.$ai_http_status).toBe(503);
    expect(body.properties.$ai_error_code).toBe("AI_PROVIDER_ERROR");
    expect(body.properties.$ai_error).toBe("Service unavailable");
  });
});
