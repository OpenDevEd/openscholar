import { describe, it, expect } from "vitest";
import { assertBucketWithinLimits } from "./limits";
import type { EffectiveCountItem } from "../../../lib/bucket/effective-paper-count";

describe("assertBucketWithinLimits", () => {
  function historyRow(limit: number): EffectiveCountItem {
    return { source: "history", searchFilters: { limit } };
  }
  function libraryRow(): EffectiveCountItem {
    return { source: "library" };
  }

  it("accepts a small honest bucket", () => {
    expect(assertBucketWithinLimits([libraryRow(), historyRow(50)]).effectiveCount).toBe(51);
  });

  it("rejects a single placeholder whose limit exceeds the per-row pull cap", () => {
    // One row, but searchFilters.limit (9999) is over the pull cap (200).
    expect(() => assertBucketWithinLimits([historyRow(9999)])).toThrow(/per-row pull cap/);
  });

  it("rejects placeholders whose post-expansion sum exceeds the paper cap", () => {
    // 10 history rows × 200 papers each = 2000 effective papers, over 1000.
    const items = Array.from({ length: 10 }, () => historyRow(200));
    expect(() => assertBucketWithinLimits(items)).toThrow(/exceeding the limit/);
  });

  it("accepts a bucket exactly at the paper cap", () => {
    const items = Array.from({ length: 5 }, () => historyRow(200));
    expect(assertBucketWithinLimits(items).effectiveCount).toBe(1000);
  });

  it("counts non-history rows as 1 each, even when bucket has many of them", () => {
    const items = Array.from({ length: 999 }, () => libraryRow());
    expect(assertBucketWithinLimits(items).effectiveCount).toBe(999);
  });

  it("rejects an empty bucket", () => {
    expect(() => assertBucketWithinLimits([])).toThrow(/at least one paper/);
  });

  it("rejects a bucket whose every history row has limit <= 0", () => {
    // Every row contributes 0 effective papers. Without the count===0
    // guard, this bucket would start queue setup that would then strand
    // the job in downloading_pdfs/indexing.
    expect(() => assertBucketWithinLimits([historyRow(0), historyRow(-5)])).toThrow(
      /at least one paper/,
    );
  });
});
