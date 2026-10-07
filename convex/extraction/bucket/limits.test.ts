import { describe, it, expect } from "vitest";
import { assertBucketWithinLimits } from "./limits";
import type { EffectiveCountItem } from "../../../lib/bucket/effective-paper-count";

describe("assertBucketWithinLimits", () => {
  const historyRow = (limit: number): EffectiveCountItem => ({ source: "history", searchFilters: { limit } });
  const libraryRow = (): EffectiveCountItem => ({ source: "library" });

  it("counts a search by the papers it pulls and every other row as one", () => {
    expect(assertBucketWithinLimits([libraryRow(), historyRow(50)]).effectiveCount).toBe(51);
  });

  it("refuses a bucket past the plan's papers, counted after expansion, and takes one at it", () => {
    const items = Array.from({ length: 10 }, () => historyRow(200));
    expect(() => assertBucketWithinLimits(items, 1_999)).toThrow(/plan takes up to 1,999 papers/);
    expect(assertBucketWithinLimits(items, 2_000).effectiveCount).toBe(2_000);
  });

  it("takes any number of papers on a plan that sets no limit", () => {
    expect(assertBucketWithinLimits([historyRow(250_000)]).effectiveCount).toBe(250_000);
  });

  it("refuses an empty bucket, and one whose every search pulls nothing", () => {
    expect(() => assertBucketWithinLimits([])).toThrow(/at least one paper/);
    expect(() => assertBucketWithinLimits([historyRow(0), historyRow(-5)])).toThrow(/at least one paper/);
  });
});
