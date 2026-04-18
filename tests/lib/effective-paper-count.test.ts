/**
 * Pure-math tests for the bucket effective-count helper.
 *
 * These guard the cap-bypass fixes in `convex/extraction/mutations/jobs.ts`
 * and `templates.ts`: a single history row can expand to many papers via
 * `searchFilters.limit`, and the helper is what turns a row count into an
 * accurate paper count for the plan-cap check.
 */
import { describe, it, expect } from "vitest";
import {
  paperCountForItem,
  effectivePaperCount,
  findOverPullCapIndex,
  type EffectiveCountItem,
} from "@/lib/bucket/effective-paper-count";

const PULL_CAP = 200;

describe("paperCountForItem", () => {
  it("non-history rows always count as 1, regardless of any stray filter", () => {
    const sources: EffectiveCountItem["source"][] = [
      "library",
      "collection",
      "zotero",
      "upload",
    ];
    for (const source of sources) {
      expect(paperCountForItem({ source }, PULL_CAP)).toBe(1);
      expect(
        paperCountForItem(
          { source, searchFilters: { limit: 50 } },
          PULL_CAP,
        ),
      ).toBe(1);
    }
  });

  it("history rows without searchFilters are per-paper (count 1)", () => {
    expect(paperCountForItem({ source: "history" }, PULL_CAP)).toBe(1);
  });

  it("history placeholder with explicit limit returns the limit", () => {
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: 25 } },
        PULL_CAP,
      ),
    ).toBe(25);
  });

  it("history placeholder with unset limit falls back to the pull cap", () => {
    // Mirrors `buildOpenAlexSearchParams` falling back to OPENALEX_MAX_PER_PAGE.
    expect(
      paperCountForItem(
        { source: "history", searchFilters: {} },
        PULL_CAP,
      ),
    ).toBe(PULL_CAP);
  });

  it("clamps a too-large limit down to the pull cap", () => {
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: 9999 } },
        PULL_CAP,
      ),
    ).toBe(PULL_CAP);
  });

  it("treats zero / negative / NaN as 'fetch nothing' (count 0)", () => {
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: 0 } },
        PULL_CAP,
      ),
    ).toBe(0);
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: -10 } },
        PULL_CAP,
      ),
    ).toBe(0);
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: Number.NaN } },
        PULL_CAP,
      ),
    ).toBe(0);
  });

  it("floors fractional limits before clamping", () => {
    expect(
      paperCountForItem(
        { source: "history", searchFilters: { limit: 7.9 } },
        PULL_CAP,
      ),
    ).toBe(7);
  });
});

describe("effectivePaperCount", () => {
  it("sums per-row counts after clamping", () => {
    const items: EffectiveCountItem[] = [
      { source: "library" },
      { source: "history", searchFilters: { limit: 50 } },
      { source: "history", searchFilters: { limit: 9999 } }, // clamps to PULL_CAP
      { source: "zotero" },
    ];
    expect(effectivePaperCount(items, PULL_CAP)).toBe(1 + 50 + PULL_CAP + 1);
  });

  it("returns 0 for an empty bucket", () => {
    expect(effectivePaperCount([], PULL_CAP)).toBe(0);
  });

  it("regression: a single placeholder slips past row count but its 200-paper expansion does not", () => {
    // The bug being fixed — `args.bucketItems.length === 1 ≤ 1000` would
    // pass a naive row-count check, but the post-expansion total is 200.
    const items: EffectiveCountItem[] = [
      { source: "history", searchFilters: { limit: 200 } },
    ];
    expect(effectivePaperCount(items, PULL_CAP)).toBe(200);
  });

  it("regression: many placeholders can multiply past the plan cap", () => {
    // 10 history rows × 200 papers each = 2000 effective papers,
    // well above the free-plan PAPER_LIMIT of 1000.
    const items: EffectiveCountItem[] = Array.from({ length: 10 }, () => ({
      source: "history" as const,
      searchFilters: { limit: 200 },
    }));
    expect(effectivePaperCount(items, PULL_CAP)).toBe(2000);
  });
});

describe("findOverPullCapIndex", () => {
  it("returns -1 when every history row is within the cap", () => {
    const items: EffectiveCountItem[] = [
      { source: "library" },
      { source: "history", searchFilters: { limit: 200 } },
      { source: "history", searchFilters: { limit: 1 } },
    ];
    expect(findOverPullCapIndex(items, PULL_CAP)).toBe(-1);
  });

  it("returns the first offending index when a row exceeds the cap", () => {
    const items: EffectiveCountItem[] = [
      { source: "library" },
      { source: "history", searchFilters: { limit: 200 } },
      { source: "history", searchFilters: { limit: 201 } },
      { source: "history", searchFilters: { limit: 9999 } },
    ];
    expect(findOverPullCapIndex(items, PULL_CAP)).toBe(2);
  });

  it("ignores non-history rows and missing-filters history rows", () => {
    const items: EffectiveCountItem[] = [
      { source: "history" },
      { source: "library", searchFilters: { limit: 9999 } },
    ];
    expect(findOverPullCapIndex(items, PULL_CAP)).toBe(-1);
  });

  it("ignores history rows whose limit is missing or non-finite (treated by paperCountForItem)", () => {
    const items: EffectiveCountItem[] = [
      { source: "history", searchFilters: {} },
      { source: "history", searchFilters: { limit: Number.NaN } },
    ];
    expect(findOverPullCapIndex(items, PULL_CAP)).toBe(-1);
  });
});
