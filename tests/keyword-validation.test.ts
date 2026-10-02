import { describe, expect, it, vi } from "vitest";

import { expandShortcuts } from "../lib/query-shortcuts";

// The Bookmarks page's shortcuts, as the browser or the server passes them.
const expand = (query: string) => expandShortcuts(query, { ml: "(machine learning OR ML)", ai: "(artificial intelligence OR AI)" });

import {
  validateAndExpandKeywords,
  validateAndExpandKeywordsSilently,
} from "../lib/keyword-validation";

describe("validateAndExpandKeywords", () => {
  it("accepts empty query", () => {
    const result = validateAndExpandKeywords("", expand);
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "",
      warnings: [],
    });
  });

  it("accepts whitespace-only query", () => {
    const result = validateAndExpandKeywords("   ", expand);
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "   ",
      warnings: [],
    });
  });

  it("rejects single character query", () => {
    const result = validateAndExpandKeywords("a", expand);
    expect(result.isValid).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it("accepts normal query", () => {
    const result = validateAndExpandKeywords("machine learning", expand);
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "machine learning",
      warnings: [],
    });
  });

  it("expands known bookmark", () => {
    const result = validateAndExpandKeywords("ml...", expand);
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "(machine learning OR ML)",
      warnings: [],
    });
  });

  it("expands multiple bookmarks", () => {
    const result = validateAndExpandKeywords("ml... AND ai...", expand);
    expect(result).toEqual({
      isValid: true,
      expandedQuery:
        "(machine learning OR ML) AND (artificial intelligence OR AI)",
      warnings: [],
    });
  });

  it("returns invalid with warnings for missing bookmark", () => {
    const result = validateAndExpandKeywords("unknown...", expand);
    expect(result.isValid).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it("uses getMessage callback for single char warning", () => {
    const result = validateAndExpandKeywords("x", expand, {
      getMessage: (key) =>
        key === "singleCharSearch" ? "Custom msg" : "fallback",
    });
    expect(result.isValid).toBe(false);
    expect(result.warnings).toContain("Custom msg");
  });

  it("invokes onWarning callback", () => {
    const onWarning = vi.fn();
    validateAndExpandKeywords("x", expand, { onWarning });
    expect(onWarning).toHaveBeenCalledOnce();
  });
});

describe("validateAndExpandKeywordsSilently", () => {
  it("accepts empty query", () => {
    const result = validateAndExpandKeywordsSilently("", expand);
    expect(result.isValid).toBe(true);
  });

  it("rejects single character", () => {
    const result = validateAndExpandKeywordsSilently("x", expand);
    expect(result.isValid).toBe(false);
  });

  it("expands known bookmark", () => {
    const result = validateAndExpandKeywordsSilently("ml...", expand);
    expect(result.isValid).toBe(true);
    expect(result.expandedQuery).toBe("(machine learning OR ML)");
  });

  it("preserves original query for missing bookmark", () => {
    const result = validateAndExpandKeywordsSilently("unknown...", expand);
    expect(result.isValid).toBe(false);
    expect(result.expandedQuery).toBe("unknown...");
  });
});
