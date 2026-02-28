import { describe, expect, it } from "vitest";
import {
  getModelPricing,
  getModelById,
  getModelsForProvider,
  getDefaultModelForProvider,
} from "../lib/ai-models";
import type { AIProvider } from "../lib/types/ai.types";

describe("getModelPricing", () => {
  it("returns zero pricing for unknown model", () => {
    const pricing = getModelPricing("openai", "nonexistent-model");
    expect(pricing).toEqual({ input: 0, output: 0 });
  });

  it("returns zero pricing for openrouter", () => {
    const pricing = getModelPricing("openrouter" as AIProvider, "any-model");
    expect(pricing).toEqual({ input: 0, output: 0 });
  });

  it("returns zero pricing for azure (empty model list)", () => {
    const pricing = getModelPricing("azure" as AIProvider, "gpt-5-mini");
    expect(pricing).toEqual({ input: 0, output: 0 });
  });

  const pricingCases = [
    {
      provider: "openai" as AIProvider,
      modelId: "gpt-5-nano",
      expected: { input: 0.05, output: 0.4 },
    },
    {
      provider: "anthropic" as AIProvider,
      modelId: "claude-3-haiku",
      expected: { input: 0.25, output: 1.25 },
    },
    {
      provider: "google" as AIProvider,
      modelId: "gemini-2.5-flash-lite",
      expected: { input: 0.1, output: 0.4 },
    },
    {
      provider: "deepseek" as AIProvider,
      modelId: "deepseek-coder",
      expected: { input: 0.14, output: 0.28 },
    },
  ];

  it.each(pricingCases)(
    "returns correct pricing for $provider / $modelId",
    ({ provider, modelId, expected }) => {
      const pricing = getModelPricing(provider, modelId);
      expect(pricing).toEqual(expected);
    }
  );
});

describe("getModelById", () => {
  it("returns model config for known model", () => {
    const model = getModelById("openai", "gpt-5-nano");
    expect(model).toBeDefined();
    expect(model!.id).toBe("gpt-5-nano");
    expect(model!.name).toBe("GPT-5 Nano");
    expect(model!.provider).toBe("openai");
    expect(model!.pricing).toEqual({ input: 0.05, output: 0.4 });
  });

  it("returns undefined for unknown model", () => {
    const model = getModelById("openai", "nonexistent-model");
    expect(model).toBeUndefined();
  });

  it("returns undefined for openrouter", () => {
    const model = getModelById("openrouter" as AIProvider, "any-model");
    expect(model).toBeUndefined();
  });

  const modelCases = [
    {
      provider: "openai" as AIProvider,
      modelId: "gpt-5.2",
      expectedName: "GPT-5.2",
    },
    {
      provider: "anthropic" as AIProvider,
      modelId: "claude-sonnet-4-5",
      expectedName: "Claude Sonnet 4.5",
    },
    {
      provider: "google" as AIProvider,
      modelId: "gemini-3-flash-preview",
      expectedName: "Gemini 3 Flash Preview",
    },
    {
      provider: "deepseek" as AIProvider,
      modelId: "deepseek-chat",
      expectedName: "DeepSeek Chat",
    },
  ];

  it.each(modelCases)(
    "returns correct model for $provider / $modelId",
    ({ provider, modelId, expectedName }) => {
      const model = getModelById(provider, modelId);
      expect(model).toBeDefined();
      expect(model!.name).toBe(expectedName);
      expect(model!.provider).toBe(provider);
    }
  );
});

describe("getModelsForProvider", () => {
  const providersWithModels: AIProvider[] = [
    "openai",
    "anthropic",
    "google",
    "deepseek",
  ];

  it.each(providersWithModels)(
    "returns non-empty array for %s",
    (provider) => {
      const models = getModelsForProvider(provider);
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        expect(model.provider).toBe(provider);
      }
    }
  );

  it("returns empty array for openrouter", () => {
    const models = getModelsForProvider("openrouter" as AIProvider);
    expect(models).toHaveLength(0);
  });

  it("returns empty array for azure", () => {
    const models = getModelsForProvider("azure" as AIProvider);
    expect(models).toHaveLength(0);
  });

  it("every model has required fields", () => {
    const models = getModelsForProvider("openai");
    for (const model of models) {
      expect(model.id).toBeDefined();
      expect(typeof model.id).toBe("string");
      expect(model.name).toBeDefined();
      expect(typeof model.name).toBe("string");
      expect(model.provider).toBe("openai");
      expect(model.pricing).toBeDefined();
      expect(typeof model.pricing.input).toBe("number");
      expect(typeof model.pricing.output).toBe("number");
    }
  });
});

describe("getDefaultModelForProvider", () => {
  const defaultCases = [
    { provider: "openai" as AIProvider, expected: "gpt-5.2" },
    { provider: "google" as AIProvider, expected: "gemini-3-flash-preview" },
    { provider: "anthropic" as AIProvider, expected: "claude-sonnet-4-5" },
    { provider: "deepseek" as AIProvider, expected: "deepseek-chat" },
    { provider: "openrouter" as AIProvider, expected: "openrouter/free" },
    { provider: "azure" as AIProvider, expected: "gpt-5-mini" },
  ];

  it.each(defaultCases)(
    "returns $expected for $provider",
    ({ provider, expected }) => {
      expect(getDefaultModelForProvider(provider)).toBe(expected);
    }
  );

  const providersWithModels: AIProvider[] = [
    "openai",
    "anthropic",
    "google",
    "deepseek",
  ];

  it.each(providersWithModels)(
    "default model exists in %s model list",
    (provider) => {
      const defaultId = getDefaultModelForProvider(provider);
      const model = getModelById(provider, defaultId);
      expect(model).toBeDefined();
    }
  );
});
