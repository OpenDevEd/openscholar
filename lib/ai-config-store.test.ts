// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useAIConfigStore } from "./store";

// Saved keys and picks live only in the person's browser: a version step must never lose them.
const migrate = useAIConfigStore.persist.getOptions().migrate!;

describe("AI settings saved in the browser", () => {
  it("keeps every key and pick, and moves a provider keys aren't offered for any more to OpenRouter", () => {
    const picks = { screening: { id: "openai/gpt-5-nano", name: "GPT-5 Nano", inputPricePerMillion: 0.05, outputPricePerMillion: 0.4 } };
    const saved = { provider: "deepseek", apiKey: "sk-deep", apiKeyMode: "local", providerApiKeys: { deepseek: "sk-deep", openrouter: "sk-or-1" }, picks };
    expect(migrate(saved, 6)).toEqual({ provider: "openrouter", apiKey: "sk-or-1", apiKeyMode: "local", providerApiKeys: saved.providerApiKeys, picks });
  });

  it("leaves an offered provider and its key as they were", () => {
    const saved = { provider: "anthropic", apiKey: "sk-ant-1", apiKeyMode: "smart", providerApiKeys: { anthropic: "sk-ant-1" } };
    expect(migrate(saved, 6)).toMatchObject({ provider: "anthropic", apiKey: "sk-ant-1", providerApiKeys: { anthropic: "sk-ant-1" }, picks: {} });
  });
});
