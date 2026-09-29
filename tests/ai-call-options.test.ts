import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { callOptions } from "../lib/ai/core/call-options";

const model = (provider: string, modelId: string) => ({ provider, modelId }) as unknown as LanguageModel;
const openrouter = (modelId: string) => model("openrouter", modelId);

describe("callOptions", () => {
  it("sends OpenRouter the effort as is, and nothing when there's none", () => {
    expect(callOptions(openrouter("openai/gpt-6-luna"), { effort: "max" })).toEqual({ openrouter: { reasoning: { effort: "max" } } });
    expect(callOptions(openrouter("openai/gpt-6-luna"))).toEqual({ openrouter: {} });
  });

  it("asks only Anthropic models to cache, since other providers cache on their own", () => {
    expect(callOptions(openrouter("anthropic/claude-sonnet-4.6"), { cache: true })).toEqual({
      openrouter: { cache_control: { type: "ephemeral" } },
    });
    expect(callOptions(openrouter("google/gemini-3.1-flash-lite-preview"), { cache: true })).toEqual({ openrouter: {} });
  });

  it("pins a session to one upstream host within OpenRouter's 256-character limit", () => {
    const options = callOptions(openrouter("z-ai/glm-5.1"), { sessionId: "t".repeat(300) });
    expect((options.openrouter as { session_id: string }).session_id).toHaveLength(256);
  });

  it("rounds an effort down to the nearest level a direct provider takes", () => {
    expect(callOptions(model("openai.responses", "gpt-6-luna"), { effort: "max" })).toEqual({ openai: { reasoningEffort: "xhigh" } });
    expect(callOptions(model("google.generative-ai", "gemini-3-pro"), { effort: "xhigh" })).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
    // Claude reasons only with thinking on, so the level sets its budget.
    expect(callOptions(model("anthropic.messages", "claude-sonnet-4-6"), { effort: "high" })).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 16384 } },
    });
    expect(callOptions(model("anthropic.messages", "claude-sonnet-4-6"), { effort: "none" })).toEqual({});
  });

  it("keeps direct OpenAI and Google keys on minimal thinking when no effort is set", () => {
    expect(callOptions(model("openai.chat", "gpt-4o"))).toEqual({ openai: { reasoningEffort: "minimal" } });
    expect(callOptions(model("google.generative-ai", "gemini-2.5-flash"))).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0, thinkingLevel: "minimal" } },
    });
  });
});
