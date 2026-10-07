/** The papers a staged bucket produces once its rows expand: what the plan's cap is measured against. */
import { describe, it, expect } from "vitest";
import { paperCountForItem, effectivePaperCount, type EffectiveCountItem } from "@/lib/bucket/effective-paper-count";
import { PAPER_PULL_DEFAULT } from "@/lib/extraction/limits";

describe("paperCountForItem", () => {
  it("counts every row but a search placeholder or a screening as one", () => {
    for (const source of ["library", "collection", "zotero", "upload"] as EffectiveCountItem["source"][]) {
      expect(paperCountForItem({ source, searchFilters: { limit: 50 } })).toBe(1);
    }
    expect(paperCountForItem({ source: "history" })).toBe(1);
  });

  it("counts a search by its limit, the default when it has none, and nothing for a bad one", () => {
    expect(paperCountForItem({ source: "history", searchFilters: { limit: 25.9 } })).toBe(25);
    expect(paperCountForItem({ source: "history", searchFilters: {} })).toBe(PAPER_PULL_DEFAULT);
    expect(paperCountForItem({ source: "history", searchFilters: { limit: -1 } })).toBe(0);
    expect(paperCountForItem({ source: "history", searchFilters: { limit: Number.NaN } })).toBe(0);
  });

  it("counts a screening by its included papers", () => {
    expect(paperCountForItem({ source: "screening", screeningSelection: { count: 1_234 } })).toBe(1_234);
  });
});

describe("effectivePaperCount", () => {
  it("adds up the expanded rows", () => {
    expect(effectivePaperCount([{ source: "library" }, { source: "history", searchFilters: { limit: 30_000 } }, { source: "screening", screeningSelection: { count: 5 } }])).toBe(30_006);
  });
});
