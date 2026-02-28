import { describe, expect, it, vi } from "vitest";

// Mock the Zustand store BEFORE importing the module under test
vi.mock("../lib/store", () => ({
  useKeywordExpansionStore: {
    getState: () => ({
      expandQuery: (query: string) => {
        const warnings: Array<{
          key: string;
          params?: Record<string, string>;
        }> = [];
        const expandedQuery = query.replace(
          /(\w[\w-]*)\.\.\./g,
          (match, keyword) => {
            if (keyword === "ml")
              return "(machine learning OR ML)";
            if (keyword === "ai")
              return "(artificial intelligence OR AI)";
            warnings.push({
              key: "bookmarkNotFound",
              params: { keyword },
            });
            return match;
          }
        );
        return { expandedQuery, warnings };
      },
    }),
  },
}));

import {
  validateAndExpandKeywords,
  validateAndExpandKeywordsSilently,
} from "../lib/keyword-validation";

describe("validateAndExpandKeywords", () => {
  it("accepts empty query", () => {
    const result = validateAndExpandKeywords("");
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "",
      warnings: [],
    });
  });

  it("accepts whitespace-only query", () => {
    const result = validateAndExpandKeywords("   ");
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "   ",
      warnings: [],
    });
  });

  it("rejects single character query", () => {
    const result = validateAndExpandKeywords("a");
    expect(result.isValid).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it("accepts normal query", () => {
    const result = validateAndExpandKeywords("machine learning");
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "machine learning",
      warnings: [],
    });
  });

  it("expands known bookmark", () => {
    const result = validateAndExpandKeywords("ml...");
    expect(result).toEqual({
      isValid: true,
      expandedQuery: "(machine learning OR ML)",
      warnings: [],
    });
  });

  it("expands multiple bookmarks", () => {
    const result = validateAndExpandKeywords("ml... AND ai...");
    expect(result).toEqual({
      isValid: true,
      expandedQuery:
        "(machine learning OR ML) AND (artificial intelligence OR AI)",
      warnings: [],
    });
  });

  it("returns invalid with warnings for missing bookmark", () => {
    const result = validateAndExpandKeywords("unknown...");
    expect(result.isValid).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it("uses getMessage callback for single char warning", () => {
    const result = validateAndExpandKeywords("x", {
      getMessage: (key) =>
        key === "singleCharSearch" ? "Custom msg" : "fallback",
    });
    expect(result.isValid).toBe(false);
    expect(result.warnings).toContain("Custom msg");
  });

  it("invokes onWarning callback", () => {
    const onWarning = vi.fn();
    validateAndExpandKeywords("x", { onWarning });
    expect(onWarning).toHaveBeenCalledOnce();
  });
});

describe("validateAndExpandKeywordsSilently", () => {
  it("accepts empty query", () => {
    const result = validateAndExpandKeywordsSilently("");
    expect(result.isValid).toBe(true);
  });

  it("rejects single character", () => {
    const result = validateAndExpandKeywordsSilently("x");
    expect(result.isValid).toBe(false);
  });

  it("expands known bookmark", () => {
    const result = validateAndExpandKeywordsSilently("ml...");
    expect(result.isValid).toBe(true);
    expect(result.expandedQuery).toBe("(machine learning OR ML)");
  });

  it("preserves original query for missing bookmark", () => {
    const result = validateAndExpandKeywordsSilently("unknown...");
    expect(result.isValid).toBe(false);
    expect(result.expandedQuery).toBe("unknown...");
  });
});
