import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import { setupTransactionAggregates } from "../../credits/aggregates.test-support";

import { parseAndValidateRequest, convertToAISdkParams, normalizeSchemaForStrictMode } from "./parseRequest";
import {
  generateResponseId,
  formatNonStreamingResponse,
  formatUsage,
  createStreamingResponse,
} from "./formatResponse";
import {
  extractEnhancedUsage,
  calculateEnhancedModelCost,
  creditsFromCost,
  type EnhancedUsage,
} from "./cost";
import { buildReasoningProviderOptions } from "./reasoning";
import { mapFinishReason } from "./constants";

// ─── Seed helpers ────────────────────────────────────────────

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides?: { email?: string; clerkId?: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: overrides?.clerkId ?? "clerk_gw_test",
      email: overrides?.email ?? "gateway@test.com",
      firstName: "Gateway",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  freeBalance: number,
  paidBalance: number,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_gw_credit_test",
      email: "gw_credit@test.com",
      firstName: "GW",
      lastName: "Credit",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance,
      paidBalance,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    return { userId, creditsId };
  });
}

async function seedWalletKey(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides?: { hashedKey?: string; isActive?: boolean; appName?: string },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("walletKeys", {
      userId,
      hashedKey: overrides?.hashedKey ?? "gw_testhash",
      keyPrefix: "wk_gwt...",
      appName: overrides?.appName ?? "GatewayTestApp",
      redirectOrigin: "https://gateway-test.com",
      isActive: overrides?.isActive ?? true,
      createdAt: Date.now(),
    });
  });
}

function makeModel(overrides?: Partial<Record<string, unknown>>) {
  const now = Date.now();
  return {
    _id: "model_123" as Id<"models">,
    _creationTime: now,
    modelId: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10.0,
    costMarkup: 1.3,
    isServed: true,
    sortOrder: 1,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Parameters<typeof calculateEnhancedModelCost>[1];
}

async function seedModel(
  t: ReturnType<typeof convexTest>,
  overrides?: Partial<{
    modelId: string;
    name: string;
    provider: string;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    reasoningPricePerMillion: number;
    cacheReadPricePerMillion: number;
    cacheWritePricePerMillion: number;
    supportedParameters: string[];
    isServed: boolean;
    sortOrder: number;
    category: string;
  }>,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("models", {
      modelId: overrides?.modelId ?? "openai/gpt-4o-test",
      name: overrides?.name ?? "GPT-4o Test",
      provider: overrides?.provider ?? "openai",
      inputPricePerMillion: overrides?.inputPricePerMillion ?? 2.5,
      outputPricePerMillion: overrides?.outputPricePerMillion ?? 10.0,
      reasoningPricePerMillion: overrides?.reasoningPricePerMillion,
      cacheReadPricePerMillion: overrides?.cacheReadPricePerMillion,
      cacheWritePricePerMillion: overrides?.cacheWritePricePerMillion,
      supportedParameters: overrides?.supportedParameters,
      costMarkup: 1.3,
      isServed: overrides?.isServed ?? true,
      sortOrder: overrides?.sortOrder ?? 1,
      category: overrides?.category,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// parseRequest — Validation
// ═══════════════════════════════════════════════════════════════

describe("parseAndValidateRequest", () => {
  it("rejects null body", () => {
    const result = parseAndValidateRequest(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON object/);
  });

  it("rejects non-object body", () => {
    const result = parseAndValidateRequest("hello");
    expect(result.ok).toBe(false);
  });

  it("rejects missing model", () => {
    const result = parseAndValidateRequest({ messages: [{ role: "user", content: "hi" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/model/);
  });

  it("rejects empty model string", () => {
    const result = parseAndValidateRequest({ model: "", messages: [{ role: "user", content: "hi" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/model/);
  });

  it("rejects missing messages", () => {
    const result = parseAndValidateRequest({ model: "gpt-4o" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/messages/);
  });

  it("rejects empty messages array", () => {
    const result = parseAndValidateRequest({ model: "gpt-4o", messages: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/messages/);
  });

  it("rejects invalid message role", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "batman", content: "hi" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/role/);
  });

  it("rejects tool message without tool_call_id", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "tool", content: "result" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tool_call_id/);
  });

  it("rejects non-number temperature", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      temperature: "hot",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/temperature/);
  });

  it("rejects non-number top_p", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      top_p: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/top_p/);
  });

  it("rejects tools that is not an array", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: "not-an-array",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tools.*array/);
  });

  it("rejects tool without function object", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tools\[0\]/);
  });

  it("rejects tool with empty function name", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "" } }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/name.*non-empty/);
  });

  it("rejects invalid response_format type", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "xml" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/response_format/);
  });

  it("rejects json_schema without name", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { schema: {} } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/json_schema\.name/);
  });

  it("rejects invalid reasoning_effort", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      reasoning_effort: "turbo",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reasoning_effort/);
  });

  it("accepts minimal valid request", () => {
    const result = parseAndValidateRequest({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.model).toBe("openai/gpt-4o");
      expect(result.request.messages).toHaveLength(1);
    }
  });

  it("accepts fully-featured request", () => {
    const result = parseAndValidateRequest({
      model: "anthropic/claude-sonnet-4-20250514",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "calc", arguments: '{"expr":"2+2"}' } },
          ],
        },
        { role: "tool", content: "4", tool_call_id: "call_1" },
      ],
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.1,
      max_completion_tokens: 1000,
      stop: ["\n\n", "END"],
      seed: 42,
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        {
          type: "function",
          function: {
            name: "calc",
            description: "Calculate math",
            parameters: { type: "object", properties: { expr: { type: "string" } }, required: ["expr"] },
          },
        },
      ],
      tool_choice: "auto",
      response_format: { type: "text" },
      reasoning_effort: "high",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts all valid reasoning_effort values", () => {
    for (const effort of ["none", "low", "medium", "high"]) {
      const result = parseAndValidateRequest({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: effort,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts null optional fields", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      temperature: null,
      top_p: null,
      max_tokens: null,
      stop: null,
      seed: null,
      stream: null,
    });
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// parseRequest — Conversion to AI SDK params
// ═══════════════════════════════════════════════════════════════

describe("convertToAISdkParams", () => {
  it("converts simple text messages", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hello" },
      ],
    });

    expect(params.messages).toHaveLength(2);
    expect(params.messages[0]).toEqual({ role: "system", content: "Be helpful" });
    expect(params.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("converts user message with image content parts", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          ],
        },
      ],
    });

    const content = params.messages[0].content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "What is this?" });
    expect(content[1]).toEqual({ type: "image", image: "https://example.com/img.png" });
  });

  it("converts assistant message with tool calls", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_abc",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
          ],
        },
      ],
    });

    const msg = params.messages[0];
    expect(msg.role).toBe("assistant");
    expect(msg.content).toBe("");
    expect((msg.toolCalls as Array<Record<string, unknown>>)[0]).toEqual({
      toolCallId: "call_abc",
      toolName: "get_weather",
      args: { city: "Paris" },
    });
  });

  it("converts tool result message", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [
        { role: "tool", content: '{"temp": 22}', tool_call_id: "call_abc" },
      ],
    });

    expect(params.messages[0]).toEqual({
      role: "tool",
      content: [{ type: "text", text: '{"temp": 22}' }],
      toolCallId: "call_abc",
    });
  });

  it("maps scalar parameters correctly", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.3,
      top_p: 0.95,
      frequency_penalty: 0.5,
      presence_penalty: 0.2,
      max_completion_tokens: 2000,
      seed: 42,
      stop: ["END", "\n\n"],
    });

    expect(params.temperature).toBe(0.3);
    expect(params.topP).toBe(0.95);
    expect(params.frequencyPenalty).toBe(0.5);
    expect(params.presencePenalty).toBe(0.2);
    expect(params.maxOutputTokens).toBe(2000);
    expect(params.seed).toBe(42);
    expect(params.stopSequences).toEqual(["END", "\n\n"]);
  });

  it("prefers max_completion_tokens over max_tokens", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 500,
      max_completion_tokens: 1000,
    });
    expect(params.maxOutputTokens).toBe(1000);
  });

  it("falls back to max_tokens when max_completion_tokens is null", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 500,
    });
    expect(params.maxOutputTokens).toBe(500);
  });

  it("converts single stop string to array", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stop: "STOP",
    });
    expect(params.stopSequences).toEqual(["STOP"]);
  });

  it("converts tools to AI SDK format", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        },
      ],
    });

    expect(params.tools).toBeDefined();
    expect(Object.keys(params.tools!)).toEqual(["get_weather", "search"]);
  });

  it("converts tool_choice string values", () => {
    for (const choice of ["auto", "none", "required"] as const) {
      const params = convertToAISdkParams({
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: choice,
      });
      expect(params.toolChoice).toBe(choice);
    }
  });

  it("converts tool_choice specific function", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(params.toolChoice).toEqual({ type: "tool", toolName: "get_weather" });
  });

  it("converts response_format json_schema to Output.object", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "UserProfile",
          description: "A user profile",
          schema: {
            type: "object",
            properties: { name: { type: "string" }, age: { type: "number" } },
            required: ["name"],
          },
        },
      },
    });
    expect(params.output).toBeDefined();
  });

  it("normalizes json_schema through the full pipeline (the original bug)", async () => {
    // This is the exact request shape that caused the 502 error.
    // "venue" is in properties but NOT in required.
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Extract metadata" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "PaperMetadata",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              authors: { type: "array", items: { type: "string" } },
              venue: { type: "string" },
              year: { type: "number" },
            },
            required: ["title", "authors", "year"],
          },
        },
      },
    });

    expect(params.output).toBeDefined();

    // Resolve the responseFormat promise to inspect the schema sent to the provider
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ type: string; schema: Record<string, unknown>; name?: string }> }).responseFormat;
    expect(rf.type).toBe("json");
    expect(rf.name).toBe("PaperMetadata");

    const schema = rf.schema as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { type: string | string[] }>;
    };

    // All properties are now required
    expect(schema.required).toEqual(["title", "authors", "venue", "year"]);
    expect(schema.additionalProperties).toBe(false);

    // Originally-required fields are untouched
    expect(schema.properties.title.type).toBe("string");
    expect(schema.properties.year.type).toBe("number");

    // "venue" was optional → widened to ["string", "null"]
    expect(schema.properties.venue.type).toEqual(["string", "null"]);

    // "authors" was required → array type untouched
    expect(schema.properties.authors.type).toBe("array");
  });

  it("normalizes nested objects inside json_schema through the pipeline", async () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "NestedTest",
          schema: {
            type: "object",
            properties: {
              author: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  affiliation: { type: "string" },
                },
                required: ["name"],
              },
            },
            required: ["author"],
          },
        },
      },
    });

    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const author = (schema.properties as Record<string, Record<string, unknown>>).author;

    // Nested object also gets normalized
    expect(author.required).toEqual(["name", "affiliation"]);
    expect(author.additionalProperties).toBe(false);

    // Nested optional field gets widened
    const authorProps = author.properties as Record<string, Record<string, unknown>>;
    expect(authorProps.name.type).toBe("string"); // was required
    expect(authorProps.affiliation.type).toEqual(["string", "null"]); // was optional
  });

  it("normalizes json_schema with no required array through the pipeline", async () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "AllOptional",
          schema: {
            type: "object",
            properties: {
              a: { type: "string" },
              b: { type: "number" },
            },
            // no required array at all
          },
        },
      },
    });

    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;

    expect(schema.required).toEqual(["a", "b"]);
    expect(schema.additionalProperties).toBe(false);

    // Both widened to nullable since neither was required
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.a.type).toEqual(["string", "null"]);
    expect(props.b.type).toEqual(["number", "null"]);
  });

  it("leaves already-compliant json_schema unchanged through the pipeline", async () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Compliant",
          schema: {
            type: "object",
            properties: {
              x: { type: "string" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
      },
    });

    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;

    expect(schema.required).toEqual(["x", "y"]);
    expect(schema.additionalProperties).toBe(false);

    // No widening — both were required
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.x.type).toBe("string");
    expect(props.y.type).toBe("number");
  });

  it("json_schema normalization does not mutate the original request", () => {
    const originalSchema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a"],
    };

    // Deep copy to compare after
    const snapshotRequired = [...originalSchema.required];
    const snapshotAType = originalSchema.properties.a.type;
    const snapshotBType = originalSchema.properties.b.type;

    convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ImmutabilityTest",
          schema: originalSchema,
        },
      },
    });

    // Original is unchanged
    expect(originalSchema.required).toEqual(snapshotRequired);
    expect(originalSchema.properties.a.type).toBe(snapshotAType);
    expect(originalSchema.properties.b.type).toBe(snapshotBType);
    expect((originalSchema as Record<string, unknown>).additionalProperties).toBeUndefined();
  });

  it("converts response_format json_object to Output.json", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    });
    expect(params.output).toBeDefined();
  });

  it("does not set output for response_format text", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "text" },
    });
    expect(params.output).toBeUndefined();
  });

  it("does not set optional params when not provided", () => {
    const params = convertToAISdkParams({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(params.temperature).toBeUndefined();
    expect(params.topP).toBeUndefined();
    expect(params.frequencyPenalty).toBeUndefined();
    expect(params.presencePenalty).toBeUndefined();
    expect(params.maxOutputTokens).toBeUndefined();
    expect(params.seed).toBeUndefined();
    expect(params.stopSequences).toBeUndefined();
    expect(params.tools).toBeUndefined();
    expect(params.toolChoice).toBeUndefined();
    expect(params.output).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// E2E: parseAndValidateRequest → convertToAISdkParams (strict-mode normalization)
// ═══════════════════════════════════════════════════════════════

describe("strict-mode normalization E2E (parse → convert)", () => {
  it("reproduces the original bug: optional property in json_schema no longer causes 502", async () => {
    // This is the exact raw JSON body that a user would POST to the gateway.
    // Previously this caused a 502 because "venue" was not in required.
    const rawBody = {
      model: "openai/gpt-4o",
      stream: false,
      messages: [
        { role: "user", content: "Extract metadata: \"Deep Learning for NLP by Smith & Jones, NeurIPS 2023\"" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "PaperMetadata",
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              authors: { type: "array", items: { type: "string" } },
              venue: { type: "string" },
              year: { type: "number" },
            },
            required: ["title", "authors", "year"],
          },
        },
      },
    };

    // Step 1: Validation passes
    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Step 2: Conversion produces valid output
    const params = convertToAISdkParams(parsed.request);
    expect(params.output).toBeDefined();

    // Step 3: The resolved schema is strict-mode compliant
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // All 4 properties are now required
    expect(schema.required).toEqual(["title", "authors", "venue", "year"]);
    expect(schema.additionalProperties).toBe(false);

    // Originally-required fields: types untouched
    expect(props.title.type).toBe("string");
    expect(props.authors.type).toBe("array");
    expect(props.year.type).toBe("number");

    // "venue" was optional → widened to nullable
    expect(props.venue.type).toEqual(["string", "null"]);
  });

  it("handles user sending schema with zero required fields", async () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Loose",
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
            },
          },
        },
      },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // All fields promoted to required, all nullable
    expect(schema.required).toEqual(["name", "email", "phone"]);
    expect(schema.additionalProperties).toBe(false);
    expect(props.name.type).toEqual(["string", "null"]);
    expect(props.email.type).toEqual(["string", "null"]);
    expect(props.phone.type).toEqual(["string", "null"]);
  });

  it("handles user sending already-compliant strict-mode schema", async () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "StrictCompliant",
          schema: {
            type: "object",
            properties: {
              x: { type: "string" },
              y: { type: "number" },
            },
            required: ["x", "y"],
            additionalProperties: false,
          },
        },
      },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // No widening — schema was already valid
    expect(props.x.type).toBe("string");
    expect(props.y.type).toBe("number");
    expect(schema.required).toEqual(["x", "y"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("normalizes nested objects in user-provided schema", async () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "extract" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "Citation",
          schema: {
            type: "object",
            properties: {
              paper: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  doi: { type: "string" },
                  abstract: { type: "string" },
                },
                required: ["title"],
              },
              relevance_score: { type: "number" },
            },
            required: ["paper"],
          },
        },
      },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // Top-level normalization
    expect(schema.required).toEqual(["paper", "relevance_score"]);
    expect(schema.additionalProperties).toBe(false);
    expect(props.relevance_score.type).toEqual(["number", "null"]);

    // Nested "paper" object normalization
    const paper = props.paper;
    expect(paper.required).toEqual(["title", "doi", "abstract"]);
    expect(paper.additionalProperties).toBe(false);
    const paperProps = paper.properties as Record<string, Record<string, unknown>>;
    expect(paperProps.title.type).toBe("string");
    expect(paperProps.doi.type).toEqual(["string", "null"]);
    expect(paperProps.abstract.type).toEqual(["string", "null"]);
  });

  it("normalizes array items with object schemas", async () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "list papers" }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "PaperList",
          schema: {
            type: "object",
            properties: {
              papers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    year: { type: "number" },
                    doi: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["papers"],
          },
        },
      },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    const rf = await (params.output as unknown as { responseFormat: PromiseLike<{ schema: Record<string, unknown> }> }).responseFormat;
    const schema = rf.schema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const items = props.papers.items as Record<string, unknown>;

    // Array items object gets normalized too
    expect(items.required).toEqual(["title", "year", "doi"]);
    expect(items.additionalProperties).toBe(false);
    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.title.type).toBe("string");
    expect(itemProps.year.type).toEqual(["number", "null"]);
    expect(itemProps.doi.type).toEqual(["string", "null"]);
  });

  it("does not affect json_object response format", () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    expect(params.output).toBeDefined();
  });

  it("does not affect text response format", () => {
    const rawBody = {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "text" },
    };

    const parsed = parseAndValidateRequest(rawBody);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const params = convertToAISdkParams(parsed.request);
    expect(params.output).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// formatResponse — Non-streaming
// ═══════════════════════════════════════════════════════════════

describe("formatNonStreamingResponse", () => {
  it("formats a simple text response", () => {
    const response = formatNonStreamingResponse({
      id: "gen_test-123",
      model: "openai/gpt-4o",
      text: "Hello, world!",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.id).toBe("gen_test-123");
    expect(response.object).toBe("chat.completion");
    expect(response.model).toBe("openai/gpt-4o");
    expect(response.choices).toHaveLength(1);
    expect(response.choices[0].index).toBe(0);
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBe("Hello, world!");
    expect(response.choices[0].message.tool_calls).toBeUndefined();
    expect(response.choices[0].finish_reason).toBe("stop");
    expect(response.usage.prompt_tokens).toBe(10);
    expect(response.usage.completion_tokens).toBe(5);
    expect(response.usage.total_tokens).toBe(15);
  });

  it("formats a response with tool calls", () => {
    const response = formatNonStreamingResponse({
      id: "gen_tools-456",
      model: "openai/gpt-4o",
      text: "",
      toolCalls: [
        { toolCallId: "call_abc", toolName: "get_weather", args: { city: "Paris" } },
        { toolCallId: "call_def", toolName: "search", args: { query: "papers" } },
      ],
      finishReason: "tool-calls",
      usage: { inputTokens: 20, outputTokens: 15, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.choices[0].message.content).toBeNull();
    expect(response.choices[0].finish_reason).toBe("tool_calls");
    expect(response.choices[0].message.tool_calls).toHaveLength(2);

    const tc1 = response.choices[0].message.tool_calls![0];
    expect(tc1.id).toBe("call_abc");
    expect(tc1.type).toBe("function");
    expect(tc1.function.name).toBe("get_weather");
    expect(tc1.function.arguments).toBe('{"city":"Paris"}');

    const tc2 = response.choices[0].message.tool_calls![1];
    expect(tc2.id).toBe("call_def");
    expect(tc2.function.name).toBe("search");
    expect(tc2.function.arguments).toBe('{"query":"papers"}');
  });

  it("includes reasoning token details when present", () => {
    const response = formatNonStreamingResponse({
      id: "gen_reason",
      model: "anthropic/claude-opus-4-20250514",
      text: "The answer is 42.",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.usage.completion_tokens_details).toEqual({
      reasoning_tokens: 30,
    });
  });

  it("includes cache token details when present", () => {
    const response = formatNonStreamingResponse({
      id: "gen_cache",
      model: "anthropic/claude-sonnet-4-20250514",
      text: "Cached response",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 200, outputTokens: 25, reasoningTokens: 0, cacheReadTokens: 150, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.usage.prompt_tokens_details).toEqual({
      cached_tokens: 150,
    });
  });

  it("omits token detail fields when zero", () => {
    const response = formatNonStreamingResponse({
      id: "gen_nodetails",
      model: "openai/gpt-4o-mini",
      text: "Simple response",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.usage.prompt_tokens_details).toBeUndefined();
    expect(response.usage.completion_tokens_details).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// formatResponse — Streaming (SSE)
// ═══════════════════════════════════════════════════════════════

describe("createStreamingResponse", () => {
  async function collectSSE(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value);
      // Split on double newlines to get individual SSE events
      const events = text.split("\n\n").filter((e) => e.trim().length > 0);
      chunks.push(...events);
    }
    return chunks;
  }

  function parseSSE(event: string): unknown {
    const dataLine = event.replace(/^data: /, "");
    if (dataLine === "[DONE]") return "[DONE]";
    return JSON.parse(dataLine);
  }

  async function* mockTextStream(): AsyncIterable<Record<string, unknown>> {
    yield { type: "text-delta", textDelta: "Hello" };
    yield { type: "text-delta", textDelta: ", world" };
    yield { type: "text-delta", textDelta: "!" };
    yield {
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 3, inputTokenDetails: {}, outputTokenDetails: {} },
    };
    yield { type: "finish", finishReason: "stop" };
  }

  it("streams text deltas as OpenAI SSE chunks", async () => {
    let finishReason = "";
    const stream = createStreamingResponse({
      id: "gen_stream_1",
      model: "openai/gpt-4o",
      fullStream: mockTextStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: (r) => { finishReason = r; },
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE);

    // First: role chunk
    const roleChunk = parsed[0] as Record<string, unknown>;
    expect((roleChunk as { choices: Array<{ delta: { role: string } }> }).choices[0].delta.role).toBe("assistant");

    // Text deltas
    const textChunks = parsed.slice(1, 4) as Array<{ choices: Array<{ delta: { content: string } }> }>;
    expect(textChunks[0].choices[0].delta.content).toBe("Hello");
    expect(textChunks[1].choices[0].delta.content).toBe(", world");
    expect(textChunks[2].choices[0].delta.content).toBe("!");

    // Finish chunk
    const finishChunk = parsed[4] as { choices: Array<{ finish_reason: string }> };
    expect(finishChunk.choices[0].finish_reason).toBe("stop");

    // [DONE]
    expect(parsed[parsed.length - 1]).toBe("[DONE]");
    expect(finishReason).toBe("stop");
  });

  it("includes usage chunk when include_usage is true", async () => {
    const stream = createStreamingResponse({
      id: "gen_usage",
      model: "openai/gpt-4o",
      fullStream: mockTextStream(),
      includeUsage: true,
      onUsage: () => {},
      onFinishReason: () => {},
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE);

    // Find usage chunk (has empty choices and usage field)
    const usageChunk = parsed.find(
      (p) => typeof p === "object" && p !== null && "usage" in (p as Record<string, unknown>) && (p as { usage: unknown }).usage !== undefined && Array.isArray((p as { choices: unknown[] }).choices) && (p as { choices: unknown[] }).choices.length === 0,
    ) as { usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } } | undefined;

    expect(usageChunk).toBeDefined();
    expect(usageChunk!.usage.prompt_tokens).toBe(10);
    expect(usageChunk!.usage.completion_tokens).toBe(3);
    expect(usageChunk!.usage.total_tokens).toBe(13);
  });

  it("does not include usage chunk when include_usage is false", async () => {
    const stream = createStreamingResponse({
      id: "gen_nousage",
      model: "openai/gpt-4o",
      fullStream: mockTextStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: () => {},
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE);

    const usageChunk = parsed.find(
      (p) => typeof p === "object" && p !== null && (p as { choices?: unknown[] }).choices?.length === 0,
    );
    expect(usageChunk).toBeUndefined();
  });

  async function* mockToolCallStream(): AsyncIterable<Record<string, unknown>> {
    yield { type: "tool-call-streaming-start", toolCallId: "call_xyz", toolName: "get_weather", toolCallIndex: 0 };
    yield { type: "tool-call-delta", toolCallIndex: 0, argsTextDelta: '{"ci' };
    yield { type: "tool-call-delta", toolCallIndex: 0, argsTextDelta: 'ty":"' };
    yield { type: "tool-call-delta", toolCallIndex: 0, argsTextDelta: 'Paris"}' };
    yield { type: "tool-call", toolCallId: "call_xyz", toolName: "get_weather", input: { city: "Paris" } };
    yield {
      type: "finish-step",
      finishReason: "tool-calls",
      usage: { inputTokens: 15, outputTokens: 8, inputTokenDetails: {}, outputTokenDetails: {} },
    };
    yield { type: "finish", finishReason: "tool-calls" };
  }

  it("streams tool calls in OpenAI SSE format", async () => {
    const stream = createStreamingResponse({
      id: "gen_tools_stream",
      model: "openai/gpt-4o",
      fullStream: mockToolCallStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: () => {},
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE).filter((p) => p !== "[DONE]") as Array<{
      choices: Array<{ delta: { role?: string; tool_calls?: Array<{ index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> }; finish_reason: string | null }>;
    }>;

    // First chunk: role
    expect(parsed[0].choices[0].delta.role).toBe("assistant");

    // Tool call start: has id, type, function.name
    const startChunk = parsed[1];
    const tc = startChunk.choices[0].delta.tool_calls![0];
    expect(tc.index).toBe(0);
    expect(tc.id).toBe("call_xyz");
    expect(tc.type).toBe("function");
    expect(tc.function!.name).toBe("get_weather");

    // Argument deltas
    const argDeltas = parsed.slice(2, 5);
    const allArgs = argDeltas
      .map((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments ?? "")
      .join("");
    expect(allArgs).toBe('{"city":"Paris"}');

    // Finish
    const finishChunk = parsed[parsed.length - 1];
    expect(finishChunk.choices[0].finish_reason).toBe("tool_calls");
  });

  async function* mockErrorStream(): AsyncIterable<Record<string, unknown>> {
    yield { type: "text-delta", textDelta: "Starting..." };
    yield { type: "error", error: new Error("Provider rate limited") };
    yield {
      type: "finish-step",
      finishReason: "error",
      usage: { inputTokens: 5, outputTokens: 1, inputTokenDetails: {}, outputTokenDetails: {} },
    };
    yield { type: "finish", finishReason: "error" };
  }

  it("emits error content in SSE stream", async () => {
    const stream = createStreamingResponse({
      id: "gen_error",
      model: "openai/gpt-4o",
      fullStream: mockErrorStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: () => {},
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE).filter((p) => p !== "[DONE]") as Array<{
      choices: Array<{ delta: { content?: string } }>;
    }>;

    // Should contain the error message in a content delta
    const errorChunk = parsed.find((p) =>
      p.choices?.[0]?.delta?.content?.includes("[ERROR]"),
    );
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.choices[0].delta.content).toContain("Provider rate limited");
  });

  async function* mockReasoningStream(): AsyncIterable<Record<string, unknown>> {
    yield { type: "reasoning-start", id: "r1" };
    yield { type: "reasoning-delta", id: "r1", text: "Let me think..." };
    yield { type: "reasoning-end", id: "r1" };
    yield { type: "text-delta", textDelta: "The answer is 42." };
    yield {
      type: "finish-step",
      finishReason: "stop",
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        inputTokenDetails: {},
        outputTokenDetails: { reasoningTokens: 5 },
      },
    };
    yield { type: "finish", finishReason: "stop" };
  }

  it("silently skips reasoning events in SSE stream", async () => {
    const stream = createStreamingResponse({
      id: "gen_reasoning",
      model: "anthropic/claude-opus-4-20250514",
      fullStream: mockReasoningStream(),
      includeUsage: true,
      onUsage: () => {},
      onFinishReason: () => {},
    });

    const events = await collectSSE(stream);
    const parsed = events.map(parseSSE).filter((p) => p !== "[DONE]") as Array<Record<string, unknown>>;

    // No reasoning events should appear — only text, finish, usage
    const textChunks = parsed.filter(
      (p) => (p as { choices?: Array<{ delta: { content?: string } }> }).choices?.[0]?.delta?.content !== undefined,
    );

    // Only the "The answer is 42." text should appear (plus the role chunk with "")
    expect(textChunks.length).toBeGreaterThanOrEqual(1);

    // Usage chunk should show reasoning tokens
    const usageChunk = parsed.find(
      (p) => (p as { choices?: unknown[] }).choices !== undefined && Array.isArray((p as { choices: unknown[] }).choices) && (p as { choices: unknown[] }).choices.length === 0,
    ) as { usage: { completion_tokens_details?: { reasoning_tokens: number } } } | undefined;
    expect(usageChunk).toBeDefined();
    expect(usageChunk!.usage.completion_tokens_details?.reasoning_tokens).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// formatResponse — Helpers
// ═══════════════════════════════════════════════════════════════

describe("generateResponseId", () => {
  it("starts with gen_ prefix", () => {
    const id = generateResponseId();
    expect(id).toMatch(/^gen_/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateResponseId()));
    expect(ids.size).toBe(100);
  });
});

describe("mapFinishReason", () => {
  it("maps AI SDK reasons to OpenAI reasons", () => {
    expect(mapFinishReason("stop")).toBe("stop");
    expect(mapFinishReason("length")).toBe("length");
    expect(mapFinishReason("tool-calls")).toBe("tool_calls");
    expect(mapFinishReason("content-filter")).toBe("content_filter");
    expect(mapFinishReason("error")).toBe("stop");
    expect(mapFinishReason("other")).toBe("stop");
  });

  it("defaults unknown reasons to stop", () => {
    expect(mapFinishReason("unknown_reason")).toBe("stop");
  });
});

// ═══════════════════════════════════════════════════════════════
// cost — Enhanced cost calculation
// ═══════════════════════════════════════════════════════════════

describe("extractEnhancedUsage", () => {
  it("extracts all fields from AI SDK usage", () => {
    const usage = extractEnhancedUsage({
      inputTokens: 100,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 80, cacheWriteTokens: 20 },
      outputTokenDetails: { reasoningTokens: 30 },
    });

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 30,
      cacheReadTokens: 80,
      cacheWriteTokens: 20,
      webSearchRequests: 0,
    });
  });

  it("defaults missing fields to 0", () => {
    const usage = extractEnhancedUsage({});
    expect(usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    });
  });

  it("handles partial details", () => {
    const usage = extractEnhancedUsage({
      inputTokens: 50,
      outputTokens: 25,
      outputTokenDetails: { reasoningTokens: 10 },
    });
    expect(usage.reasoningTokens).toBe(10);
    expect(usage.cacheReadTokens).toBe(0);
    expect(usage.cacheWriteTokens).toBe(0);
  });
});

describe("calculateEnhancedModelCost", () => {
  it("calculates basic input/output cost", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
    });
    const usage: EnhancedUsage = {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // input: 1M * 2.5/1M = 2.5, output: 0.5M * 10/1M = 5.0
    expect(cost).toBeCloseTo(7.5, 5);
  });

  it("includes reasoning token cost with dedicated pricing", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      reasoningPricePerMillion: 15.0,
    });
    const usage: EnhancedUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 200_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // input: 0.1M * 2.5 = 0.25, output: 0.05M * 10 = 0.5, reasoning: 0.2M * 15 = 3.0
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it("falls back to output price for reasoning when no dedicated pricing", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      // No reasoningPricePerMillion
    });
    const usage: EnhancedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // reasoning: 1M * 10/1M (falls back to output price) = 10.0
    expect(cost).toBeCloseTo(10.0, 5);
  });

  it("includes cache read and write costs", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      cacheReadPricePerMillion: 0.25,
      cacheWritePricePerMillion: 3.75,
    });
    const usage: EnhancedUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cacheReadTokens: 800_000,
      cacheWriteTokens: 100_000,
      webSearchRequests: 0,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // input: 0.1M * 2.5 = 0.25
    // output: 0.05M * 10 = 0.5
    // cacheRead: 0.8M * 0.25 = 0.2
    // cacheWrite: 0.1M * 3.75 = 0.375
    expect(cost).toBeCloseTo(1.325, 5);
  });

  it("handles zero usage", () => {
    const model = makeModel();
    const usage: EnhancedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };
    expect(calculateEnhancedModelCost(usage, model)).toBe(0);
  });
});

describe("creditsFromCost", () => {
  it("converts dollars to credits with markup", () => {
    // Default: 10,000 credits per USD
    // 0.001 * 1.3 = 0.0013000...002 (IEEE 754), * 10000 = 13.000...002, ceil = 14
    const credits = creditsFromCost(0.001, 1.3);
    expect(credits).toBe(14);

    // Clean multiplication: 0.01 * 1.0 * 10000 = 100
    expect(creditsFromCost(0.01, 1.0)).toBe(100);
  });

  it("rounds up to nearest credit", () => {
    const credits = creditsFromCost(0.00001, 1.0);
    // 0.00001 * 1.0 * 10000 = 0.1 → ceil = 1
    expect(credits).toBe(1);
  });

  it("returns minimum 1 credit for any non-zero cost", () => {
    const credits = creditsFromCost(0.0000001, 1.0);
    expect(credits).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 for zero cost", () => {
    const credits = creditsFromCost(0, 1.3);
    expect(credits).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// reasoning — Provider options mapping
// ═══════════════════════════════════════════════════════════════

describe("buildReasoningProviderOptions", () => {
  const reasoningModel = makeModel({ supportedParameters: ["tools", "reasoning", "temperature"] });
  const nonReasoningModel = makeModel({ supportedParameters: ["tools", "temperature"] });

  it("returns undefined for effort 'none'", () => {
    expect(buildReasoningProviderOptions("anthropic", "none", reasoningModel)).toBeUndefined();
  });

  it("returns undefined for model without reasoning support", () => {
    expect(buildReasoningProviderOptions("anthropic", "high", nonReasoningModel)).toBeUndefined();
  });

  it("returns undefined for model with no supportedParameters", () => {
    const model = makeModel({ supportedParameters: undefined });
    expect(buildReasoningProviderOptions("anthropic", "high", model)).toBeUndefined();
  });

  it("returns undefined for unknown provider", () => {
    expect(buildReasoningProviderOptions("mistral", "high", reasoningModel)).toBeUndefined();
  });

  describe("anthropic", () => {
    it("maps low effort to 1024 budget", () => {
      const opts = buildReasoningProviderOptions("anthropic", "low", reasoningModel);
      expect(opts).toEqual({
        anthropic: { thinking: { type: "enabled", budgetTokens: 1_024 } },
      });
    });

    it("maps medium effort to 8192 budget", () => {
      const opts = buildReasoningProviderOptions("anthropic", "medium", reasoningModel);
      expect(opts).toEqual({
        anthropic: { thinking: { type: "enabled", budgetTokens: 8_192 } },
      });
    });

    it("maps high effort to 32768 budget", () => {
      const opts = buildReasoningProviderOptions("anthropic", "high", reasoningModel);
      expect(opts).toEqual({
        anthropic: { thinking: { type: "enabled", budgetTokens: 32_768 } },
      });
    });
  });

  describe("openai", () => {
    it("passes effort directly as reasoningEffort", () => {
      expect(buildReasoningProviderOptions("openai", "low", reasoningModel)).toEqual({
        openai: { reasoningEffort: "low" },
      });
      expect(buildReasoningProviderOptions("openai", "medium", reasoningModel)).toEqual({
        openai: { reasoningEffort: "medium" },
      });
      expect(buildReasoningProviderOptions("openai", "high", reasoningModel)).toEqual({
        openai: { reasoningEffort: "high" },
      });
    });
  });

  describe("deepseek", () => {
    it("enables thinking for any non-none effort", () => {
      for (const effort of ["low", "medium", "high"] as const) {
        expect(buildReasoningProviderOptions("deepseek", effort, reasoningModel)).toEqual({
          deepseek: { thinking: { type: "enabled" } },
        });
      }
    });
  });

  describe("google", () => {
    it("maps efforts to thinking budgets", () => {
      expect(buildReasoningProviderOptions("google", "low", reasoningModel)).toEqual({
        google: { thinkingConfig: { thinkingBudget: 1_024 } },
      });
      expect(buildReasoningProviderOptions("google", "high", reasoningModel)).toEqual({
        google: { thinkingConfig: { thinkingBudget: 32_768 } },
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration — Data layer (convex-test)
// ═══════════════════════════════════════════════════════════════

describe("gateway integration (data layer)", () => {
  it("full pipeline: key lookup → balance check → model lookup → credit deduction", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, creditsId } = await seedUserWithCredits(t, 500, 200);
    await seedWalletKey(t, userId, { hashedKey: "gw_pipeline_hash", appName: "PipelineApp" });
    await seedModel(t, {
      modelId: "openai/gpt-4o",
      name: "GPT-4o",
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      supportedParameters: ["tools", "reasoning", "structured_outputs"],
    });

    // Step 1: Key lookup
    const keyResult = await t.query(internal.wallet.internal.lookupKey, {
      hashedKey: "gw_pipeline_hash",
    });
    expect(keyResult).not.toBeNull();
    expect(keyResult!.appName).toBe("PipelineApp");

    // Step 2: Balance check
    const balance = await t.query(internal.credits.internal.getBalanceByUserId, {
      userId: keyResult!.userId,
    });
    expect(balance).not.toBeNull();
    expect(balance!.total).toBe(700);

    // Step 3: Model lookup
    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/gpt-4o",
    });
    expect(model).not.toBeNull();
    expect(model!.supportedParameters).toContain("reasoning");

    // Step 4: Credit deduction (simulating a generation)
    const remaining = await t.mutation(internal.credits.internal.deductCredits, {
      userId: keyResult!.userId,
      amount: 25,
      description: "Wallet API: GPT-4o",
      metadata: {
        source: "wallet_api",
        appName: "PipelineApp",
        model: "openai/gpt-4o",
        provider: "openai",
        inputTokens: "1500",
        outputTokens: "500",
        reasoningTokens: "0",
        cacheReadTokens: "0",
        finishReason: "stop",
      },
    });
    expect(remaining).toBe(675);

    // Verify transaction
    const txns = await t.run(async (ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
        .collect(),
    );
    expect(txns).toHaveLength(1);
    expect(txns[0].metadata?.source).toBe("wallet_api");
    expect(txns[0].metadata?.reasoningTokens).toBe("0");
  });

  it("rejects deduction when balance is insufficient", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserWithCredits(t, 5, 0);
    await seedWalletKey(t, userId, { hashedKey: "gw_insufficient" });

    const balance = await t.query(internal.credits.internal.getBalanceByUserId, {
      userId,
    });
    expect(balance!.total).toBe(5);

    // Attempt to deduct more than available
    await expect(
      t.mutation(internal.credits.internal.deductCredits, {
        userId,
        amount: 100,
        description: "Wallet API: too expensive",
        metadata: { source: "wallet_api" },
      }),
    ).rejects.toThrow();
  });

  it("revoked key cannot proceed through pipeline", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const userId = await seedUser(t);
    const walletKeyId = await seedWalletKey(t, userId, { hashedKey: "gw_revoked_hash" });

    // Revoke the key
    await t.mutation(internal.wallet.internal.revokeKey, {
      walletKeyId,
      userId,
    });

    // Lookup should return null — pipeline stops here
    const keyResult = await t.query(internal.wallet.internal.lookupKey, {
      hashedKey: "gw_revoked_hash",
    });
    expect(keyResult).toBeNull();
  });

  it("non-served model is rejected", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedModel(t, { modelId: "openai/deprecated-model", isServed: false });

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/deprecated-model",
    });
    expect(model).toBeNull();
  });

  it("deduction with reasoning token metadata records correctly", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, creditsId } = await seedUserWithCredits(t, 1000, 0);

    await t.mutation(internal.credits.internal.deductCredits, {
      userId,
      amount: 50,
      description: "Wallet API: Claude Opus",
      metadata: {
        source: "wallet_api",
        appName: "ReasoningApp",
        model: "anthropic/claude-opus-4-20250514",
        provider: "anthropic",
        inputTokens: "2000",
        outputTokens: "800",
        reasoningTokens: "5000",
        cacheReadTokens: "1500",
        finishReason: "stop",
      },
    });

    const txns = await t.run(async (ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))
        .collect(),
    );

    expect(txns).toHaveLength(1);
    expect(txns[0].metadata?.reasoningTokens).toBe("5000");
    expect(txns[0].metadata?.cacheReadTokens).toBe("1500");
    expect(txns[0].metadata?.provider).toBe("anthropic");
  });
});

// ═══════════════════════════════════════════════════════════════
// formatUsage
// ═══════════════════════════════════════════════════════════════

describe("formatUsage", () => {
  it("formats basic usage without details", () => {
    const result = formatUsage({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    });

    expect(result.prompt_tokens).toBe(100);
    expect(result.completion_tokens).toBe(50);
    expect(result.total_tokens).toBe(150);
    expect(result.prompt_tokens_details).toBeUndefined();
    expect(result.completion_tokens_details).toBeUndefined();
  });

  it("includes reasoning token details", () => {
    const result = formatUsage({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    });

    expect(result.completion_tokens_details).toEqual({ reasoning_tokens: 20 });
  });

  it("includes cache token details", () => {
    const result = formatUsage({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 0,
      cacheReadTokens: 75,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    });

    expect(result.prompt_tokens_details).toEqual({ cached_tokens: 75 });
  });

  it("includes both details when present", () => {
    const result = formatUsage({
      inputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 40,
      cacheReadTokens: 150,
      cacheWriteTokens: 50,
      webSearchRequests: 0,
    });

    expect(result.total_tokens).toBe(300);
    expect(result.prompt_tokens_details).toEqual({ cached_tokens: 150 });
    expect(result.completion_tokens_details).toEqual({ reasoning_tokens: 40 });
  });
});

// ═══════════════════════════════════════════════════════════════
// Web search — Validation
// ═══════════════════════════════════════════════════════════════

describe("web search validation", () => {
  it("accepts valid web_search_options", () => {
    const result = parseAndValidateRequest({
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "What happened today?" }],
      web_search_options: {
        search_context_size: "high",
        user_location: {
          type: "approximate",
          city: "San Francisco",
          country: "US",
          region: "California",
          timezone: "America/Los_Angeles",
        },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts empty web_search_options object", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      web_search_options: {},
    });
    expect(result.ok).toBe(true);
  });

  it("accepts null web_search_options", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      web_search_options: null,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid search_context_size", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      web_search_options: { search_context_size: "ultra" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/search_context_size/);
  });

  it("rejects user_location without type approximate", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      web_search_options: {
        user_location: { type: "exact", latitude: 37.7749 },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/approximate/);
  });

  it("accepts web_search_options with domain filters", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      web_search_options: {
        allowed_domains: ["arxiv.org", "pubmed.ncbi.nlm.nih.gov"],
        blocked_domains: ["spam.com"],
        max_uses: 5,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts web_search_options alongside tools", () => {
    const result = parseAndValidateRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "search and calculate" }],
      web_search_options: { search_context_size: "medium" },
      tools: [
        { type: "function", function: { name: "calc", description: "Calculate", parameters: { type: "object", properties: {} } } },
      ],
      tool_choice: "auto",
    });
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Web search — Non-streaming response with annotations
// ═══════════════════════════════════════════════════════════════

describe("web search annotations in response", () => {
  it("includes annotations when sources are provided", () => {
    const response = formatNonStreamingResponse({
      id: "gen_ws_1",
      model: "openai/gpt-4o",
      text: "According to recent research, AI is advancing rapidly.",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 50, outputTokens: 20, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 3 },
      sources: [
        { url: "https://arxiv.org/abs/2401.12345", title: "AI Advances 2024" },
        { url: "https://nature.com/articles/ai-review", title: "Nature AI Review" },
      ],
    });

    expect(response.choices[0].message.annotations).toHaveLength(2);
    expect(response.choices[0].message.annotations![0]).toEqual({
      type: "url_citation",
      url_citation: { url: "https://arxiv.org/abs/2401.12345", title: "AI Advances 2024" },
    });
    expect(response.choices[0].message.annotations![1]).toEqual({
      type: "url_citation",
      url_citation: { url: "https://nature.com/articles/ai-review", title: "Nature AI Review" },
    });
  });

  it("omits annotations when no sources", () => {
    const response = formatNonStreamingResponse({
      id: "gen_ws_2",
      model: "openai/gpt-4o",
      text: "Hello world",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
    });

    expect(response.choices[0].message.annotations).toBeUndefined();
  });

  it("omits annotations when sources array is empty", () => {
    const response = formatNonStreamingResponse({
      id: "gen_ws_3",
      model: "openai/gpt-4o",
      text: "No sources",
      toolCalls: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 },
      sources: [],
    });

    expect(response.choices[0].message.annotations).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Web search — Streaming source tracking
// ═══════════════════════════════════════════════════════════════

describe("web search source tracking in stream", () => {
  async function* mockWebSearchStream(): AsyncIterable<Record<string, unknown>> {
    yield { type: "source", sourceType: "url", id: "src_1", url: "https://arxiv.org/paper1", title: "Paper 1" };
    yield { type: "text-delta", textDelta: "According to " };
    yield { type: "source", sourceType: "url", id: "src_2", url: "https://nature.com/article", title: "Nature Article" };
    yield { type: "text-delta", textDelta: "research..." };
    yield { type: "source", sourceType: "url", id: "src_3", url: "https://science.org/paper", title: "Science Paper" };
    yield {
      type: "finish-step",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 30, inputTokenDetails: {}, outputTokenDetails: {} },
    };
    yield { type: "finish", finishReason: "stop" };
  }

  it("counts source events for web search costing", async () => {
    let reportedSourceCount = 0;

    const stream = createStreamingResponse({
      id: "gen_ws_stream",
      model: "openai/gpt-4o",
      fullStream: mockWebSearchStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: () => {},
      onSourceCount: (count) => { reportedSourceCount = count; },
    });

    // Consume the stream
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(reportedSourceCount).toBe(3);
  });

  it("reports 0 sources when no source events", async () => {
    async function* noSourceStream(): AsyncIterable<Record<string, unknown>> {
      yield { type: "text-delta", textDelta: "No web search used." };
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 5, inputTokenDetails: {}, outputTokenDetails: {} },
      };
      yield { type: "finish", finishReason: "stop" };
    }

    let reportedSourceCount = -1;

    const stream = createStreamingResponse({
      id: "gen_no_ws",
      model: "openai/gpt-4o",
      fullStream: noSourceStream(),
      includeUsage: false,
      onUsage: () => {},
      onFinishReason: () => {},
      onSourceCount: (count) => { reportedSourceCount = count; },
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // onSourceCount should NOT have been called (0 sources)
    expect(reportedSourceCount).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Web search — Cost calculation
// ═══════════════════════════════════════════════════════════════

describe("web search cost calculation", () => {
  it("includes web search price in cost", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      webSearchPrice: 0.025,
    });
    const usage: EnhancedUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 3,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // input: 0.1M * 2.5 = 0.25
    // output: 0.05M * 10 = 0.5
    // web search: 3 * 0.025 = 0.075
    expect(cost).toBeCloseTo(0.825, 5);
  });

  it("ignores web search cost when webSearchPrice is undefined", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      // No webSearchPrice
    });
    const usage: EnhancedUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 5,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    // Only input + output, no web search cost
    expect(cost).toBeCloseTo(0.75, 5);
  });

  it("handles zero web search requests", () => {
    const model = makeModel({
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      webSearchPrice: 0.025,
    });
    const usage: EnhancedUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 0,
    };

    const cost = calculateEnhancedModelCost(usage, model);
    expect(cost).toBeCloseTo(0.75, 5);
  });

  it("falls back to OpenRouter server-tool rate when webSearchPrice is null but web search ran", () => {
    // Many top OpenRouter models (e.g. openai/gpt-5) have no native web
    // search and `pricing.web_search` is null. When the gateway invokes
    // a web_search tool against such a model, OpenRouter falls back to
    // the Exa/Parallel server tool at ~$0.02/call (5 results × $0.004).
    // The previous code computed `webSearchRequests * (webSearchPrice ?? 0)`
    // and silently recorded $0 — a billing leak. With pickWebSearchPricing
    // we charge the server-tool rate so credit deductions match what
    // OpenRouter actually bills us.
    const model = makeModel({
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      // webSearchPrice intentionally undefined
      costMarkup: 2.0,
    });
    const usage: EnhancedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 1,
    };

    const usdCost = calculateEnhancedModelCost(usage, model);
    expect(usdCost).toBeCloseTo(0.02, 6);

    const credits = creditsFromCost(usdCost, model.costMarkup);
    // ceil(0.02 × 2.0 × 10_000) = 400
    expect(credits).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// normalizeSchemaForStrictMode
// ═══════════════════════════════════════════════════════════════

describe("normalizeSchemaForStrictMode", () => {
  it("adds all properties to required and sets additionalProperties: false", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        title: { type: "string" },
        year: { type: "number" },
      },
      required: ["title"],
    });

    expect(result.required).toEqual(["title", "year"]);
    expect(result.additionalProperties).toBe(false);
  });

  it("widens originally-optional properties to nullable", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        title: { type: "string" },
        venue: { type: "string" },
      },
      required: ["title"],
    });

    // title stays as-is (was already required)
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.title.type).toBe("string");

    // venue was optional → widened to ["string", "null"]
    expect(props.venue.type).toEqual(["string", "null"]);

    // Both are now required
    expect(result.required).toEqual(["title", "venue"]);
  });

  it("does not double-add null to already-nullable type arrays", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        value: { type: ["string", "null"] },
      },
      required: [],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.value.type).toEqual(["string", "null"]);
  });

  it("handles anyOf by adding { type: null } variant", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        field: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
      required: [],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    const anyOf = props.field.anyOf as Array<Record<string, unknown>>;
    expect(anyOf).toHaveLength(3);
    expect(anyOf[2]).toEqual({ type: "null" });
  });

  it("does not double-add null to anyOf that already has it", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        field: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: [],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    const anyOf = props.field.anyOf as Array<Record<string, unknown>>;
    expect(anyOf).toHaveLength(2);
  });

  it("handles oneOf by adding { type: null } variant", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        field: { oneOf: [{ type: "string" }, { type: "number" }] },
      },
      required: [],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    const oneOf = props.field.oneOf as Array<Record<string, unknown>>;
    expect(oneOf).toHaveLength(3);
    expect(oneOf[2]).toEqual({ type: "null" });
  });

  it("recursively normalizes nested objects", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        author: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name"],
        },
      },
      required: ["author"],
    });

    const author = (result.properties as Record<string, Record<string, unknown>>).author;
    expect(author.required).toEqual(["name", "email"]);
    expect(author.additionalProperties).toBe(false);

    const authorProps = author.properties as Record<string, Record<string, unknown>>;
    expect(authorProps.name.type).toBe("string");
    expect(authorProps.email.type).toEqual(["string", "null"]);
  });

  it("recursively normalizes array items that are objects", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        papers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              doi: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["papers"],
    });

    const papers = (result.properties as Record<string, Record<string, unknown>>).papers;
    const items = papers.items as Record<string, unknown>;
    expect(items.required).toEqual(["title", "doi"]);
    expect(items.additionalProperties).toBe(false);

    const itemProps = items.properties as Record<string, Record<string, unknown>>;
    expect(itemProps.doi.type).toEqual(["string", "null"]);
  });

  it("handles the exact bug case: properties not all in required", () => {
    // This was the original failing request
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" } },
        venue: { type: "string" },
        year: { type: "number" },
      },
      required: ["title", "authors", "year"],
    });

    expect(result.required).toEqual(["title", "authors", "venue", "year"]);
    expect(result.additionalProperties).toBe(false);

    const props = result.properties as Record<string, Record<string, unknown>>;
    // Originally required fields stay untouched
    expect(props.title.type).toBe("string");
    expect(props.year.type).toBe("number");
    // venue was optional → now nullable
    expect(props.venue.type).toEqual(["string", "null"]);
  });

  it("handles schema with no required array", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    });

    expect(result.required).toEqual(["a", "b"]);
    expect(result.additionalProperties).toBe(false);
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.a.type).toEqual(["string", "null"]);
    expect(props.b.type).toEqual(["number", "null"]);
  });

  it("handles schema where all properties are already required", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    // No widening — both were already required
    expect(props.a.type).toBe("string");
    expect(props.b.type).toBe("number");
    expect(result.additionalProperties).toBe(false);
  });

  it("does not mutate the original schema", () => {
    const original = {
      type: "object",
      properties: {
        a: { type: "string" },
      },
      required: [] as string[],
    };

    normalizeSchemaForStrictMode(original);

    // Original unchanged
    expect(original.required).toEqual([]);
    expect((original as Record<string, unknown>).additionalProperties).toBeUndefined();
    expect((original.properties as Record<string, Record<string, unknown>>).a.type).toBe("string");
  });

  it("passes through non-object schemas unchanged", () => {
    const result = normalizeSchemaForStrictMode({ type: "string" });
    expect(result).toEqual({ type: "string" });
  });

  it("handles deeply nested composition keywords", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        data: {
          anyOf: [
            {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x"],
            },
            { type: "null" },
          ],
        },
      },
      required: ["data"],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    const anyOf = props.data.anyOf as Array<Record<string, unknown>>;
    const objVariant = anyOf[0];
    expect(objVariant.required).toEqual(["x", "y"]);
    expect(objVariant.additionalProperties).toBe(false);
  });

  it("wraps typeless optional properties in anyOf with null", () => {
    const result = normalizeSchemaForStrictMode({
      type: "object",
      properties: {
        meta: { description: "some metadata" },
      },
      required: [],
    });

    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.meta.anyOf).toEqual([
      { description: "some metadata" },
      { type: "null" },
    ]);
  });
});
