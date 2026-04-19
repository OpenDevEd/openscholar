import { describe, it, expect } from "vitest";
import { extractMatchSnippet } from "@/lib/chat/search/match-snippet";

describe("extractMatchSnippet", () => {
  it("R1: empty query returns null", () => {
    expect(extractMatchSnippet("any source text", "")).toBeNull();
    expect(extractMatchSnippet("any source text", "   ")).toBeNull();
  });

  it("R2: query not present in the source returns null", () => {
    expect(extractMatchSnippet("hello world", "xyz")).toBeNull();
    expect(extractMatchSnippet("", "anything")).toBeNull();
  });

  it("R3: query at the start of source has no leading ellipsis", () => {
    const long =
      "photosynthesis powers the carbon cycle in coral reefs across the equatorial pacific ocean";
    const result = extractMatchSnippet(long, "photosynthesis", 60);
    expect(result).not.toBeNull();
    expect(result!.text.startsWith("\u2026")).toBe(false);
    expect(result!.text.startsWith("photosynthesis")).toBe(true);
  });

  it("R4: query at the end of source has no trailing ellipsis", () => {
    const long =
      "the carbon cycle in coral reefs across the equatorial pacific photosynthesis";
    const result = extractMatchSnippet(long, "photosynthesis", 60);
    expect(result).not.toBeNull();
    expect(result!.text.endsWith("\u2026")).toBe(false);
    expect(result!.text.endsWith("photosynthesis")).toBe(true);
  });

  it("R5: query in the middle of a long source emits both leading and trailing ellipsis", () => {
    const long =
      "the carbon cycle in coral reefs across the equatorial pacific includes photosynthesis as a key driver of biomass production over geologic time scales";
    const result = extractMatchSnippet(long, "photosynthesis", 60);
    expect(result).not.toBeNull();
    expect(result!.text.startsWith("\u2026")).toBe(true);
    expect(result!.text.endsWith("\u2026")).toBe(true);
    expect(result!.text).toContain("photosynthesis");
  });

  it("R6: snippet text length never exceeds maxLen + 2 (one per ellipsis)", () => {
    const long =
      "the carbon cycle in coral reefs across the equatorial pacific includes photosynthesis as a key driver of biomass production over geologic time scales";
    const result = extractMatchSnippet(long, "photosynthesis", 60);
    expect(result).not.toBeNull();
    expect(result!.text.length).toBeLessThanOrEqual(60 + 2);
  });

  it("R7: highlightRanges point to the exact match substring inside the snippet text", () => {
    const long =
      "the carbon cycle in coral reefs across the equatorial pacific includes photosynthesis as a key driver of biomass production over geologic time scales";
    const result = extractMatchSnippet(long, "photosynthesis", 60);
    expect(result).not.toBeNull();
    expect(result!.highlightRanges).toHaveLength(1);
    const [start, end] = result!.highlightRanges[0];
    expect(result!.text.slice(start, end)).toBe("photosynthesis");
  });
});
