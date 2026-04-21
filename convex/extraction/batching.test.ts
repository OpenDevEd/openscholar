import { describe, expect, it } from "vitest";

import {
  chunk,
  normalizeBatchSize,
  resolveBoundedConcurrency,
} from "./batching";

describe("convex/extraction/batching", () => {
  it("chunks a list into bounded batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns no batches for an empty list", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("normalizes zero and negative sizes to a valid dispatch size", () => {
    expect(normalizeBatchSize(0)).toBe(1);
    expect(normalizeBatchSize(-3)).toBe(1);
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2, 3], -2)).toEqual([[1], [2], [3]]);
  });

  it("keeps the infra clamp separate from entitlement while never returning < 1", () => {
    expect(resolveBoundedConcurrency(5, 3)).toBe(3);
    expect(resolveBoundedConcurrency(5, 0)).toBe(1);
    expect(resolveBoundedConcurrency(5, -4)).toBe(1);
  });
});
