import { describe, it, expect } from "vitest";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { bucketItemToServerInput } from "@/lib/bucket/to-server-input";

function baseItem(overrides: Partial<BucketItem> = {}): BucketItem {
  return {
    bucketKey: "k",
    source: "library",
    sourceRefId: "r",
    title: "t",
    authors: [],
    addedAt: 1,
    status: "ready",
    ...overrides,
  };
}

describe("bucketItemToServerInput", () => {
  it("injects limit = paperCount into searchFilters for a history item", () => {
    const item = baseItem({
      source: "history",
      paperCount: 120,
      sourceMeta: {
        searchFilters: {
          query: "cancer",
          field: "title_and_abstract",
          yearRange: [2020, 2024],
        },
      },
    });
    const out = bucketItemToServerInput(item);
    expect(out.searchFilters).toEqual({
      query: "cancer",
      field: "title_and_abstract",
      yearRange: [2020, 2024],
      limit: 120,
    });
  });

  it("preserves stored searchFilters when a history item has no paperCount", () => {
    const item = baseItem({
      source: "history",
      sourceMeta: {
        searchFilters: { query: "cancer" },
      },
    });
    const out = bucketItemToServerInput(item);
    expect(out.searchFilters?.query).toBe("cancer");
    expect(out.searchFilters?.limit).toBeUndefined();
  });

  it("sends NO searchFilters for a library item", () => {
    const out = bucketItemToServerInput(
      baseItem({ source: "library", paperCount: 5 }),
    );
    expect(out.searchFilters).toBeUndefined();
  });

  it("maps zotero meta fields, NOT a limit (per-paper source)", () => {
    const item = baseItem({
      source: "zotero",
      sourceMeta: {
        libraryType: "group",
        groupId: "g1",
        zoteroUserId: "u1",
        collectionKey: "c1",
      },
    });
    const out = bucketItemToServerInput(item);
    expect(out.libraryType).toBe("group");
    expect(out.groupId).toBe("g1");
    expect(out.zoteroUserId).toBe("u1");
    expect(out.collectionKey).toBe("c1");
    expect(out.searchFilters).toBeUndefined();
  });

  it("passes through every top-level bucket-item field", () => {
    const item = baseItem({
      bucketKey: "openalex:W42",
      source: "library",
      sourceRefId: "r42",
      title: "Paper",
      authors: ["A", "B"],
      year: 2020,
      doi: "10.1/a",
      openalexId: "W42",
      abstract: "abstract text",
      pdfUrl: "https://x/y.pdf",
    });
    const out = bucketItemToServerInput(item);
    expect(out.bucketKey).toBe("openalex:W42");
    expect(out.source).toBe("library");
    expect(out.sourceRefId).toBe("r42");
    expect(out.title).toBe("Paper");
    expect(out.authors).toEqual(["A", "B"]);
    expect(out.year).toBe(2020);
    expect(out.doi).toBe("10.1/a");
    expect(out.openalexId).toBe("W42");
    expect(out.abstract).toBe("abstract text");
    expect(out.pdfUrl).toBe("https://x/y.pdf");
  });

  it("coerces a missing sourceMeta on a history item to just {limit}", () => {
    const out = bucketItemToServerInput(
      baseItem({ source: "history", paperCount: 42 }),
    );
    expect(out.searchFilters).toEqual({ limit: 42 });
  });
});
