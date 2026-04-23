import { describe, it, expect } from "vitest";
import { estimateTokenCount } from "./abortTokenEstimate";

describe("estimateTokenCount", () => {
  it("returns 0 for empty or whitespace-less input", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("returns a positive integer count for real text", () => {
    // "Hello, world!" is 4 tokens in cl100k_base: "Hello", ",", " world", "!"
    const count = estimateTokenCount("Hello, world!");
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it("scales roughly with text length", () => {
    const short = estimateTokenCount("hi");
    const long = estimateTokenCount(
      "This is a long sentence. ".repeat(50),
    );
    expect(long).toBeGreaterThan(short * 10);
  });

  it("is deterministic for the same input", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(estimateTokenCount(text)).toBe(estimateTokenCount(text));
  });
});
