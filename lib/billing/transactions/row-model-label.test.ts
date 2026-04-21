import { describe, it, expect } from "vitest";
import { humanizeModelId } from "./row-model-label";

describe("humanizeModelId", () => {
  it("strips vendor prefix", () => {
    expect(humanizeModelId("google/gemini-flash")).toBe("Gemini Flash");
  });

  it("drops pure-numeric version tokens", () => {
    expect(humanizeModelId("google/gemini-3.1-flash-lite")).toBe("Gemini Flash Lite");
  });

  it("drops trailing preview/beta/latest suffixes", () => {
    expect(humanizeModelId("google/gemini-3.1-flash-lite-preview")).toBe("Gemini Flash Lite");
    expect(humanizeModelId("anthropic/claude-sonnet-beta")).toBe("Claude Sonnet");
    expect(humanizeModelId("openai/gpt-5-latest")).toBe("GPT");
  });

  it("uppercases known acronyms", () => {
    expect(humanizeModelId("openai/gpt-4o")).toBe("GPT 4o");
  });

  it("returns null for null or empty input", () => {
    expect(humanizeModelId(null)).toBeNull();
    expect(humanizeModelId(undefined)).toBeNull();
    expect(humanizeModelId("")).toBeNull();
    expect(humanizeModelId("   ")).toBeNull();
  });

  it("handles ids with no vendor prefix", () => {
    expect(humanizeModelId("claude-opus-4-7")).toBe("Claude Opus");
  });

  it("preserves mixed-case version suffixes that are not pure numeric", () => {
    expect(humanizeModelId("openai/gpt-4o-mini")).toBe("GPT 4o Mini");
  });

  it("returns bare token when every other token is filtered out", () => {
    expect(humanizeModelId("x/4-7")).toBe("4-7");
  });
});
