import { describe, expect, it } from "vitest";
import {
  getProviderConfig,
  getDefaultModelForProvider,
} from "../lib/ai-models";
import type { AIProvider } from "../lib/types/ai.types";

describe("getProviderConfig", () => {
  const providers: AIProvider[] = ["openai", "google", "anthropic", "deepseek", "openrouter", "azure"];

  it.each(providers)("returns config for %s", (provider) => {
    const config = getProviderConfig(provider);
    expect(config.id).toBe(provider);
    expect(config.name).toBeDefined();
    expect(config.apiKeyUrl).toBeDefined();
    expect(config.apiKeyPlaceholder).toBeDefined();
  });
});

describe("getDefaultModelForProvider", () => {
  const defaultCases = [
    { provider: "openai" as AIProvider, expected: "gpt-4o" },
    { provider: "google" as AIProvider, expected: "gemini-2.5-flash" },
    { provider: "anthropic" as AIProvider, expected: "claude-sonnet-4-5" },
    { provider: "deepseek" as AIProvider, expected: "deepseek-chat" },
    { provider: "openrouter" as AIProvider, expected: "anthropic/claude-sonnet-4-5" },
    { provider: "azure" as AIProvider, expected: "gpt-4o" },
  ];

  it.each(defaultCases)(
    "returns $expected for $provider",
    ({ provider, expected }) => {
      expect(getDefaultModelForProvider(provider)).toBe(expected);
    }
  );
});
