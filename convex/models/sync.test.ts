import { describe, expect, it } from "vitest";
import { transformModel } from "./sync";

const RAW_BASE = {
  id: "anthropic/claude-sonnet-4.5",
  name: "Claude Sonnet 4.5",
  pricing: {
    prompt: "0.000003",
    completion: "0.000015",
  },
} as const;

describe("transformModel — webSearchPrice unit", () => {
  it("treats pricing.web_search as dollars per call (not per token)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "0.01" },
    });
    expect(out).not.toBeNull();
    expect(out!.webSearchPrice).toBe(0.01);
  });

  it("preserves the exact $/call value for native search-preview models", () => {
    const out = transformModel({
      ...RAW_BASE,
      id: "openai/gpt-4o-mini-search-preview",
      pricing: { ...RAW_BASE.pricing, web_search: "0.0275" },
    });
    expect(out!.webSearchPrice).toBe(0.0275);
  });

  it("maps a $0 web_search to 0 (free, e.g., Firecrawl pass-through)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "0" },
    });
    expect(out!.webSearchPrice).toBe(0);
  });

  it("returns undefined when pricing.web_search is missing", () => {
    const out = transformModel({ ...RAW_BASE });
    expect(out!.webSearchPrice).toBeUndefined();
  });

  it("returns undefined for the meta-model '-1' sentinel", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { ...RAW_BASE.pricing, web_search: "-1" },
    });
    expect(out!.webSearchPrice).toBeUndefined();
  });
});

describe("transformModel — token pricing unchanged", () => {
  it("still multiplies prompt/completion by 1M (per-token → per-million)", () => {
    const out = transformModel({
      ...RAW_BASE,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    });
    expect(out!.inputPricePerMillion).toBe(3);
    expect(out!.outputPricePerMillion).toBe(15);
  });
});
