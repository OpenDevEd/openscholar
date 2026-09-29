import { describe, expect, it } from "vitest";
import { keyFor, keyModelId, keyToAdd } from "../lib/ai/keys";

describe("which saved key runs a model", () => {
  it("prefers the model's own provider, then OpenRouter, which runs every model", () => {
    expect(keyFor("anthropic/claude-sonnet-4.6", { anthropic: "sk-ant", openrouter: "sk-or" })).toBe("anthropic");
    expect(keyFor("anthropic/claude-sonnet-4.6", { openrouter: "sk-or" })).toBe("openrouter");
    expect(keyFor("z-ai/glm-5.1", { openai: "sk-oa" })).toBeNull();
    expect(keyToAdd("z-ai/glm-5.1")).toBe("openrouter");
    expect(keyToAdd("google/gemini-3-pro")).toBe("google");
    // OpenRouter-only variants never go to the provider's own API.
    expect(keyFor("openai/gpt-oss-120b:free", { openai: "sk-oa", openrouter: "sk-or" })).toBe("openrouter");
    expect(keyFor("openai/gpt-oss-120b:free", { openai: "sk-oa" })).toBeNull();
  });

  it("calls a provider's own API with its native id and OpenRouter with the slug", () => {
    expect(keyModelId("anthropic/claude-sonnet-4.6", "anthropic")).toBe("claude-sonnet-4-6");
    expect(keyModelId("anthropic/claude-sonnet-4.6", "openrouter")).toBe("anthropic/claude-sonnet-4.6");
  });
});
