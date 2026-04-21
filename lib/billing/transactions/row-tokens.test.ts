import { describe, it, expect } from "vitest";
import {
  formatTokenCount,
  formatTokenUsageSummary,
  parseTokensFromMetadata,
} from "./row-tokens";

describe("formatTokenCount", () => {
  it("renders < 1000 as plain integer", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(273)).toBe("273");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("renders 1000-9999 as K with one decimal, trimming .0", () => {
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(1200)).toBe("1.2K");
    expect(formatTokenCount(9800)).toBe("9.8K");
  });

  it("renders 10_000-999_999 as rounded K integer", () => {
    expect(formatTokenCount(10_000)).toBe("10K");
    expect(formatTokenCount(31_207)).toBe("31K");
    expect(formatTokenCount(999_499)).toBe("999K");
  });

  it("renders >= 1M as M with one decimal, trimming .0", () => {
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_200_000)).toBe("1.2M");
    expect(formatTokenCount(9_800_000)).toBe("9.8M");
  });

  it("clamps negative / non-finite to 0", () => {
    expect(formatTokenCount(-1)).toBe("0");
    expect(formatTokenCount(Number.NaN)).toBe("0");
    expect(formatTokenCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatTokenUsageSummary", () => {
  it("returns '31K in / 273 out' for realistic chat usage", () => {
    expect(
      formatTokenUsageSummary({ input: 31207, output: 273 }),
    ).toBe("31K in / 273 out");
  });

  it("omits the 0 side", () => {
    expect(formatTokenUsageSummary({ input: 100, output: 0 })).toBe("100 in");
    expect(formatTokenUsageSummary({ input: 0, output: 42 })).toBe("42 out");
  });

  it("returns null when both are absent", () => {
    expect(formatTokenUsageSummary({ input: null, output: null })).toBeNull();
    expect(formatTokenUsageSummary({})).toBeNull();
  });

  it("returns null when both are zero", () => {
    expect(formatTokenUsageSummary({ input: 0, output: 0 })).toBeNull();
  });

  it("ignores non-finite values", () => {
    expect(
      formatTokenUsageSummary({ input: Number.NaN, output: 10 }),
    ).toBe("10 out");
  });
});

describe("parseTokensFromMetadata", () => {
  it("parses real batch_screening-style metadata", () => {
    expect(
      parseTokensFromMetadata({
        inputTokens: "31207",
        outputTokens: "273",
        model: "google/gemini-3.1-flash-lite-preview",
      }),
    ).toEqual({ input: 31207, output: 273 });
  });

  it("returns nulls when the keys are absent", () => {
    expect(parseTokensFromMetadata({})).toEqual({ input: null, output: null });
    expect(parseTokensFromMetadata(null)).toEqual({ input: null, output: null });
  });

  it("returns nulls for malformed strings", () => {
    expect(
      parseTokensFromMetadata({ inputTokens: "abc", outputTokens: "-5" }),
    ).toEqual({ input: null, output: null });
  });
});
