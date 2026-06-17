import { describe, it, expect } from "vitest";
import { toNativeModelId } from "./native-model-id";

describe("toNativeModelId — openai", () => {
  it("strips the openai/ prefix", () => {
    expect(toNativeModelId("openai/gpt-4o", "openai")).toBe("gpt-4o");
    expect(toNativeModelId("openai/gpt-4.1-mini", "openai")).toBe("gpt-4.1-mini");
  });

  it("rewrites the OpenRouter `*-chat` alias to the native `*-chat-latest`", () => {
    expect(toNativeModelId("openai/gpt-5-chat", "openai")).toBe("gpt-5-chat-latest");
    expect(toNativeModelId("openai/gpt-5.1-chat", "openai")).toBe("gpt-5.1-chat-latest");
  });

  it("does not double-suffix an id that is already *-chat-latest", () => {
    expect(toNativeModelId("openai/gpt-5-chat-latest", "openai")).toBe("gpt-5-chat-latest");
  });

  it("drops an OpenRouter :variant suffix", () => {
    expect(toNativeModelId("openai/gpt-4o:extended", "openai")).toBe("gpt-4o");
  });
});

describe("toNativeModelId — anthropic", () => {
  it("strips the prefix and converts dotted versions to dashes (undated alias)", () => {
    expect(toNativeModelId("anthropic/claude-sonnet-4.6", "anthropic")).toBe("claude-sonnet-4-6");
    expect(toNativeModelId("anthropic/claude-3.5-haiku", "anthropic")).toBe("claude-3-5-haiku");
  });

  it("converts every dot, keeping word suffixes", () => {
    expect(toNativeModelId("anthropic/claude-opus-4.8-fast", "anthropic")).toBe("claude-opus-4-8-fast");
  });
});

describe("toNativeModelId — google", () => {
  it("strips the prefix, keeps dots, and adds NO models/ prefix", () => {
    expect(toNativeModelId("google/gemini-2.5-pro", "google")).toBe("gemini-2.5-pro");
    expect(toNativeModelId("google/gemini-2.0-flash-001", "google")).toBe("gemini-2.0-flash-001");
  });

  it("drops an OpenRouter :free / :variant suffix", () => {
    expect(toNativeModelId("google/gemma-4-31b-it:free", "google")).toBe("gemma-4-31b-it");
  });
});

describe("toNativeModelId — deepseek", () => {
  it("strips the prefix", () => {
    expect(toNativeModelId("deepseek/deepseek-v4-pro", "deepseek")).toBe("deepseek-v4-pro");
  });
});

describe("toNativeModelId — robustness", () => {
  it("passes through an already-bare id (no vendor prefix)", () => {
    expect(toNativeModelId("gpt-4o", "openai")).toBe("gpt-4o");
  });
});
