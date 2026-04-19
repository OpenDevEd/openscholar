import { describe, expect, it } from "vitest";
import { summarizeChatSources } from "@/lib/bucket/chat-source-stats";
import type { BucketItem } from "@/lib/bucket/bucketItem";

function makeItem(overrides: Partial<BucketItem>): BucketItem {
  return {
    bucketKey: "k1",
    source: "history",
    sourceRefId: "ref_1",
    title: "Paper",
    authors: [],
    addedAt: 0,
    status: "ready",
    ...overrides,
  };
}

describe("summarizeChatSources", () => {
  it("ignores saved-search placeholders when counting missing abstracts", () => {
    const stats = summarizeChatSources([
      makeItem({
        bucketKey: "history:search_1",
        title: "heart disease",
        paperCount: 2,
        sourceMeta: {
          isSavedSearch: true,
        },
      }),
    ]);

    expect(stats.totalPapers).toBe(2);
    expect(stats.unresolvedPapers).toBe(2);
    expect(stats.concretePapers).toBe(0);
    expect(stats.missingAbstractPapers).toBe(0);
    expect(stats.withAbstractPapers).toBe(0);
  });

  it("counts concrete ready papers with and without abstracts", () => {
    const stats = summarizeChatSources([
      makeItem({
        bucketKey: "paper_1",
        openalexId: "W1",
        abstract: "Has abstract",
      }),
      makeItem({
        bucketKey: "paper_2",
        openalexId: "W2",
        abstract: "",
      }),
      makeItem({
        bucketKey: "paper_3",
        openalexId: "W3",
        status: "uploading",
      }),
    ]);

    expect(stats.totalPapers).toBe(2);
    expect(stats.concretePapers).toBe(2);
    expect(stats.unresolvedPapers).toBe(0);
    expect(stats.withAbstractPapers).toBe(1);
    expect(stats.missingAbstractPapers).toBe(1);
  });
});
