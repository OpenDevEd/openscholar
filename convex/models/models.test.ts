import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal, api } from "../_generated/api";
import schema from "../schema";

// ─── Seed helpers ────────────────────────────────────────────

async function seedModel(
  t: ReturnType<typeof convexTest>,
  overrides?: Partial<{
    modelId: string;
    name: string;
    provider: string;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    isServed: boolean;
    costMarkup: number;
    sortOrder: number;
    category: string;
    contextLength: number;
    maxCompletionTokens: number;
    modality: string;
    tokenizer: string;
    supportedParameters: string[];
    knowledgeCutoff: string;
    expirationDate: string;
    description: string;
  }>,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("models", {
      modelId: overrides?.modelId ?? "openai/test-model",
      name: overrides?.name ?? "Test Model",
      provider: overrides?.provider ?? "openai",
      inputPricePerMillion: overrides?.inputPricePerMillion ?? 1.0,
      outputPricePerMillion: overrides?.outputPricePerMillion ?? 5.0,
      description: overrides?.description,
      costMarkup: overrides?.costMarkup ?? 1.3,
      isServed: overrides?.isServed ?? false,
      sortOrder: overrides?.sortOrder ?? 100,
      category: overrides?.category,
      contextLength: overrides?.contextLength,
      maxCompletionTokens: overrides?.maxCompletionTokens,
      modality: overrides?.modality,
      tokenizer: overrides?.tokenizer,
      supportedParameters: overrides?.supportedParameters,
      knowledgeCutoff: overrides?.knowledgeCutoff,
      expirationDate: overrides?.expirationDate,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ─── Public query: list ──────────────────────────────────────

describe("models.queries.list", () => {
  it("returns all models when no provider filter", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", provider: "openai" });
    await seedModel(t, { modelId: "anthropic/claude-sonnet-4-5", provider: "anthropic" });
    await seedModel(t, { modelId: "google/gemini-2.5-flash", provider: "google" });

    const models = await t.query(api.models.queries.list, {});
    expect(models).toHaveLength(3);
  });

  it("filters by provider when specified", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", provider: "openai" });
    await seedModel(t, { modelId: "openai/gpt-5", provider: "openai" });
    await seedModel(t, { modelId: "anthropic/claude-sonnet-4-5", provider: "anthropic" });

    const openaiModels = await t.query(api.models.queries.list, { provider: "openai" });
    expect(openaiModels).toHaveLength(2);
    expect(openaiModels.every((m) => m.provider === "openai")).toBe(true);
  });

  it("returns empty array for unknown provider", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", provider: "openai" });

    const models = await t.query(api.models.queries.list, { provider: "nonexistent" });
    expect(models).toHaveLength(0);
  });

  it("includes all fields in response", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "anthropic/claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      provider: "anthropic",
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      contextLength: 200000,
      maxCompletionTokens: 8192,
      modality: "text+image->text",
      tokenizer: "Claude",
      supportedParameters: ["tools", "reasoning", "temperature"],
      knowledgeCutoff: "2025-09-01",
      category: "flagship",
    });

    const models = await t.query(api.models.queries.list, { provider: "anthropic" });
    expect(models).toHaveLength(1);

    const m = models[0];
    expect(m.modelId).toBe("anthropic/claude-sonnet-4-5");
    expect(m.name).toBe("Claude Sonnet 4.5");
    expect(m.provider).toBe("anthropic");
    expect(m.inputPricePerMillion).toBe(3.0);
    expect(m.outputPricePerMillion).toBe(15.0);
    expect(m.contextLength).toBe(200000);
    expect(m.maxCompletionTokens).toBe(8192);
    expect(m.modality).toBe("text+image->text");
    expect(m.tokenizer).toBe("Claude");
    expect(m.supportedParameters).toEqual(["tools", "reasoning", "temperature"]);
    expect(m.knowledgeCutoff).toBe("2025-09-01");
    expect(m.category).toBe("flagship");
  });
});

describe("models.queries.listCatalogOptions", () => {
  it("returns a compact settings catalog shape for a provider", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "anthropic/claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      provider: "anthropic",
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      description: "Balanced reasoning model" as never,
      contextLength: 200000,
      category: "flagship",
      modality: "text+image->text",
      tokenizer: "Claude",
      costMarkup: 1.9,
      sortOrder: 1,
    });

    const models = await t.query(api.models.queries.listCatalogOptions, {
      provider: "anthropic",
    });
    expect(models).toHaveLength(1);

    expect(models[0]).toEqual({
      _id: expect.any(String),
      modelId: "anthropic/claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      provider: "anthropic",
      description: "Balanced reasoning model",
      contextLength: 200000,
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      category: "flagship",
      modality: "text+image->text",
      tokenizer: "Claude",
    });
  });

  it("omits catalog fields the settings page does not use", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "openai/gpt-4o",
      provider: "openai",
      name: "GPT-4o",
      costMarkup: 2.1,
      sortOrder: 5,
      isServed: true,
      supportedParameters: ["tools"],
    });

    const models = await t.query(api.models.queries.listCatalogOptions, {
      provider: "openai",
    });

    expect(models).toHaveLength(1);
    expect(models[0]).toHaveProperty("_id", expect.any(String));
    expect(models[0]).not.toHaveProperty("costMarkup");
    expect(models[0]).not.toHaveProperty("sortOrder");
    expect(models[0]).not.toHaveProperty("isServed");
    expect(models[0]).not.toHaveProperty("supportedParameters");
  });
});

// ─── Internal query: listServed ──────────────────────────────

describe("models.queries.listServed", () => {
  it("returns only served models", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/served-1", isServed: true, sortOrder: 1 });
    await seedModel(t, { modelId: "openai/served-2", isServed: true, sortOrder: 2 });
    await seedModel(t, { modelId: "openai/not-served", isServed: false });

    const models = await t.query(internal.models.queries.listServed);
    const ids = models.map((m) => m.modelId);
    expect(ids).toContain("openai/served-1");
    expect(ids).toContain("openai/served-2");
    expect(ids).not.toContain("openai/not-served");
  });

  it("returns models sorted by sortOrder", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/third", isServed: true, sortOrder: 30 });
    await seedModel(t, { modelId: "openai/first", isServed: true, sortOrder: 10 });
    await seedModel(t, { modelId: "openai/second", isServed: true, sortOrder: 20 });

    const models = await t.query(internal.models.queries.listServed);
    expect(models.map((m) => m.modelId)).toEqual([
      "openai/first",
      "openai/second",
      "openai/third",
    ]);
  });
});

// ─── Internal query: getServedByModelId ──────────────────────

describe("models.queries.getServedByModelId", () => {
  it("returns served model by exact ID", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "openai/gpt-4o",
      name: "GPT-4o",
      isServed: true,
    });

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/gpt-4o",
    });
    expect(model).not.toBeNull();
    expect(model!.name).toBe("GPT-4o");
  });

  it("returns null for non-served model", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/hidden", isServed: false });

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/hidden",
    });
    expect(model).toBeNull();
  });

  it("returns null for non-existent model", async () => {
    const t = convexTest(schema);

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/nonexistent",
    });
    expect(model).toBeNull();
  });
});

// ─── Internal query: getPricing ──────────────────────────────

describe("models.queries.getPricing", () => {
  it("returns pricing for existing model", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "anthropic/claude-sonnet-4-5",
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
    });

    const pricing = await t.query(internal.models.queries.getPricing, {
      modelId: "anthropic/claude-sonnet-4-5",
    });
    expect(pricing).toEqual({ input: 3.0, output: 15.0 });
  });

  it("returns pricing for free models (zero pricing)", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "google/gemma-4-26b:free",
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
    });

    const pricing = await t.query(internal.models.queries.getPricing, {
      modelId: "google/gemma-4-26b:free",
    });
    expect(pricing).toEqual({ input: 0, output: 0 });
  });

  it("returns null for non-existent model", async () => {
    const t = convexTest(schema);

    const pricing = await t.query(internal.models.queries.getPricing, {
      modelId: "nonexistent/model",
    });
    expect(pricing).toBeNull();
  });
});

// ─── Mutation: upsertBatch ───────────────────────────────────

describe("models.mutations.upsertBatch", () => {
  it("inserts new models with correct defaults", async () => {
    const t = convexTest(schema);

    const written = await t.mutation(internal.models.mutations.upsertBatch, {
      entries: [
        {
          modelId: "openai/gpt-4o",
          name: "GPT-4o",
          provider: "openai",
          inputPricePerMillion: 2.5,
          outputPricePerMillion: 10.0,
        },
      ],
    });

    expect(written).toBe(1);

    const models = await t.query(api.models.queries.list, { provider: "openai" });
    expect(models).toHaveLength(1);

    const m = models[0];
    expect(m.isServed).toBe(false); // default
    expect(m.costMarkup).toBe(1.3); // default
    expect(m.sortOrder).toBe(1000); // default
  });

  it("preserves business overrides on update", async () => {
    const t = convexTest(schema);

    // First, seed a model with custom business overrides
    await seedModel(t, {
      modelId: "openai/gpt-4o",
      name: "GPT-4o",
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      isServed: true,
      costMarkup: 1.5,
      sortOrder: 5,
      category: "flagship",
    });

    // Now upsert with updated pricing (simulating a sync)
    await t.mutation(internal.models.mutations.upsertBatch, {
      entries: [
        {
          modelId: "openai/gpt-4o",
          name: "GPT-4o (Updated)",
          provider: "openai",
          inputPricePerMillion: 3.0, // price changed
          outputPricePerMillion: 12.0, // price changed
          contextLength: 128000, // new field
        },
      ],
    });

    const models = await t.query(api.models.queries.list, { provider: "openai" });
    const m = models[0];

    // Synced fields updated
    expect(m.name).toBe("GPT-4o (Updated)");
    expect(m.inputPricePerMillion).toBe(3.0);
    expect(m.outputPricePerMillion).toBe(12.0);
    expect(m.contextLength).toBe(128000);

    // Business overrides preserved
    expect(m.isServed).toBe(true);
    expect(m.costMarkup).toBe(1.5);
    expect(m.sortOrder).toBe(5);
    expect(m.category).toBe("flagship");
  });

  it("handles batch of multiple models", async () => {
    const t = convexTest(schema);

    const written = await t.mutation(internal.models.mutations.upsertBatch, {
      entries: [
        { modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai", inputPricePerMillion: 2.5, outputPricePerMillion: 10.0 },
        { modelId: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic", inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
        { modelId: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google", inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 },
      ],
    });

    expect(written).toBe(3);

    const all = await t.query(api.models.queries.list, {});
    expect(all).toHaveLength(3);
  });

  it("stores all optional architecture fields", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.models.mutations.upsertBatch, {
      entries: [
        {
          modelId: "anthropic/claude-sonnet-4-5",
          name: "Claude Sonnet 4.5",
          provider: "anthropic",
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 15.0,
          modality: "text+image->text",
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          tokenizer: "Claude",
          instructType: "chatml",
          cacheReadPricePerMillion: 0.3,
          reasoningPricePerMillion: 3.75,
          contextLength: 200000,
          maxCompletionTokens: 8192,
          isModerated: false,
          supportedParameters: ["tools", "reasoning", "structured_outputs"],
          knowledgeCutoff: "2025-09-01",
          expirationDate: "2027-01-01",
          defaultTemperature: 1.0,
        },
      ],
    });

    const models = await t.query(api.models.queries.list, { provider: "anthropic" });
    const m = models[0];

    expect(m.modality).toBe("text+image->text");
    expect(m.inputModalities).toEqual(["text", "image"]);
    expect(m.outputModalities).toEqual(["text"]);
    expect(m.tokenizer).toBe("Claude");
    expect(m.instructType).toBe("chatml");
    expect(m.cacheReadPricePerMillion).toBe(0.3);
    expect(m.reasoningPricePerMillion).toBe(3.75);
    expect(m.contextLength).toBe(200000);
    expect(m.maxCompletionTokens).toBe(8192);
    expect(m.isModerated).toBe(false);
    expect(m.supportedParameters).toEqual(["tools", "reasoning", "structured_outputs"]);
    expect(m.knowledgeCutoff).toBe("2025-09-01");
    expect(m.expirationDate).toBe("2027-01-01");
    expect(m.defaultTemperature).toBe(1.0);
  });
});

// ─── Mutation: setServed ─────────────────────────────────────

describe("models.mutations.setServed", () => {
  it("marks a model as served", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", isServed: false });

    await t.mutation(internal.models.mutations.setServed, {
      modelId: "openai/gpt-4o",
      isServed: true,
    });

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/gpt-4o",
    });
    expect(model).not.toBeNull();
    expect(model!.isServed).toBe(true);
  });

  it("unmarks a model as served", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", isServed: true });

    await t.mutation(internal.models.mutations.setServed, {
      modelId: "openai/gpt-4o",
      isServed: false,
    });

    const model = await t.query(internal.models.queries.getServedByModelId, {
      modelId: "openai/gpt-4o",
    });
    expect(model).toBeNull();
  });

  it("updates business overrides in same call", async () => {
    const t = convexTest(schema);
    await seedModel(t, {
      modelId: "openai/gpt-4o",
      isServed: false,
      costMarkup: 1.3,
      sortOrder: 100,
    });

    await t.mutation(internal.models.mutations.setServed, {
      modelId: "openai/gpt-4o",
      isServed: true,
      costMarkup: 2.0,
      sortOrder: 1,
      category: "premium",
    });

    const models = await t.query(api.models.queries.list, { provider: "openai" });
    const m = models[0];
    expect(m.costMarkup).toBe(2.0);
    expect(m.sortOrder).toBe(1);
    expect(m.category).toBe("premium");
  });

  it("throws for non-existent model", async () => {
    const t = convexTest(schema);

    await expect(
      t.mutation(internal.models.mutations.setServed, {
        modelId: "openai/nonexistent",
        isServed: true,
      }),
    ).rejects.toThrow("not found");
  });
});

// ─── Cross-provider scenarios ────────────────────────────────

describe("cross-provider model scenarios", () => {
  it("handles models from many providers", async () => {
    const t = convexTest(schema);

    await t.mutation(internal.models.mutations.upsertBatch, {
      entries: [
        { modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai", inputPricePerMillion: 2.5, outputPricePerMillion: 10.0 },
        { modelId: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet 4.5", provider: "anthropic", inputPricePerMillion: 3.0, outputPricePerMillion: 15.0 },
        { modelId: "google/gemini-2.5-flash", name: "Gemini Flash", provider: "google", inputPricePerMillion: 0.3, outputPricePerMillion: 2.5 },
        { modelId: "deepseek/deepseek-chat", name: "DeepSeek Chat", provider: "deepseek", inputPricePerMillion: 0.14, outputPricePerMillion: 0.28 },
        { modelId: "meta-llama/llama-4-405b", name: "Llama 4 405B", provider: "meta-llama", inputPricePerMillion: 0.8, outputPricePerMillion: 0.8 },
        { modelId: "qwen/qwen3-8b", name: "Qwen3 8B", provider: "qwen", inputPricePerMillion: 0.05, outputPricePerMillion: 0.05 },
      ],
    });

    // Total count
    const all = await t.query(api.models.queries.list, {});
    expect(all).toHaveLength(6);

    // Per-provider filtering
    expect((await t.query(api.models.queries.list, { provider: "openai" })).length).toBe(1);
    expect((await t.query(api.models.queries.list, { provider: "meta-llama" })).length).toBe(1);
    expect((await t.query(api.models.queries.list, { provider: "qwen" })).length).toBe(1);
  });

  it("getPricing works across providers", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "deepseek/deepseek-chat", provider: "deepseek", inputPricePerMillion: 0.14, outputPricePerMillion: 0.28 });

    const pricing = await t.query(internal.models.queries.getPricing, {
      modelId: "deepseek/deepseek-chat",
    });
    expect(pricing).toEqual({ input: 0.14, output: 0.28 });
  });

  it("served models span multiple providers", async () => {
    const t = convexTest(schema);
    await seedModel(t, { modelId: "openai/gpt-4o", provider: "openai", isServed: true, sortOrder: 1 });
    await seedModel(t, { modelId: "anthropic/claude-sonnet-4-5", provider: "anthropic", isServed: true, sortOrder: 2 });
    await seedModel(t, { modelId: "google/gemini-2.5-flash", provider: "google", isServed: false });

    const served = await t.query(internal.models.queries.listServed);
    expect(served).toHaveLength(2);
    expect(served.map((m) => m.provider)).toContain("openai");
    expect(served.map((m) => m.provider)).toContain("anthropic");
  });
});
