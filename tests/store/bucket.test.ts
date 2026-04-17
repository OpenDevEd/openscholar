/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, test } from "vitest";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { useBucketStore } from "@/lib/store/bucket";

function makeItem(
  key: string,
  overrides: Partial<BucketItem> = {},
): BucketItem {
  return {
    bucketKey: key,
    source: "history",
    sourceRefId: key,
    title: `Title for ${key}`,
    authors: [],
    addedAt: 1,
    status: "ready",
    ...overrides,
  };
}

beforeEach(() => {
  useBucketStore.getState().clear();
  window.localStorage.clear();
});

const NO_CAP = Number.POSITIVE_INFINITY;

describe("useBucketStore", () => {
  test("addMany adds items in insertion order", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b], NO_CAP);
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:a", "k:b"]);
    expect(state.items[a.bucketKey]).toEqual(a);
    expect(state.items[b.bucketKey]).toEqual(b);
  });

  test("addMany dedupes on bucketKey without reordering", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b], NO_CAP);
    useBucketStore.getState().addMany([a], NO_CAP);
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:a", "k:b"]);
  });

  test("addMany returns { added, deduped, capped } for a fresh batch", () => {
    const result = useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b")], NO_CAP);
    expect(result).toEqual({ added: 2, deduped: 0, capped: 0 });
  });

  test("addMany counts bucketKey collisions as deduped, not added", () => {
    useBucketStore.getState().addMany([makeItem("k:a")], NO_CAP);
    const result = useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b")], NO_CAP);
    expect(result).toEqual({ added: 1, deduped: 1, capped: 0 });
  });

  test("addMany drops items past the limit as capped and leaves them out of order", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b")], 3);
    const result = useBucketStore
      .getState()
      .addMany([makeItem("k:c"), makeItem("k:d"), makeItem("k:e")], 3);
    expect(result).toEqual({ added: 1, deduped: 0, capped: 2 });
    expect(useBucketStore.getState().order).toEqual(["k:a", "k:b", "k:c"]);
  });

  test("addMany cap counts only ready items toward the limit", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a", { status: "uploading" })], 1);
    const result = useBucketStore
      .getState()
      .addMany([makeItem("k:b")], 1);
    expect(result).toEqual({ added: 1, deduped: 0, capped: 0 });
  });

  test("addMany cap sums paperCount — a saved-search entry costs N slots", () => {
    // Limit 1000. One entry costing 800 papers + another costing 300
    // should hit the cap: 800 lands, 300 gets dropped (800 + 300 > 1000).
    const res = useBucketStore.getState().addMany(
      [
        makeItem("k:big", { paperCount: 800 }),
        makeItem("k:med", { paperCount: 300 }),
      ],
      1000,
    );
    expect(res).toEqual({ added: 1, deduped: 0, capped: 1 });
    expect(useBucketStore.getState().order).toEqual(["k:big"]);
  });

  test("addMany cap: paperCount exhausts remaining slots exactly", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a", { paperCount: 600 })], 1000);
    const res = useBucketStore
      .getState()
      .addMany([makeItem("k:b", { paperCount: 400 })], 1000);
    expect(res).toEqual({ added: 1, deduped: 0, capped: 0 });
  });

  test("addMany cap: paperCount default is 1 for per-paper sources", () => {
    // Two items without paperCount and one with — the with-count row
    // takes 50 slots, the others 1 each. Limit 52 → all three land.
    const res = useBucketStore.getState().addMany(
      [
        makeItem("k:a"),
        makeItem("k:big", { paperCount: 50 }),
        makeItem("k:b"),
      ],
      52,
    );
    expect(res).toEqual({ added: 3, deduped: 0, capped: 0 });
  });

  test("remove drops one key and leaves the rest", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b], NO_CAP);
    useBucketStore.getState().remove("k:a");
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:b"]);
    expect(state.items["k:a"]).toBeUndefined();
  });

  test("removeMany drops every listed key in one set()", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b"), makeItem("k:c")], NO_CAP);
    useBucketStore.getState().removeMany(["k:a", "k:c"]);
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:b"]);
    expect(state.items["k:a"]).toBeUndefined();
    expect(state.items["k:c"]).toBeUndefined();
  });

  test("removeMany ignores unknown keys and still removes known ones", () => {
    useBucketStore.getState().addMany([makeItem("k:a")], NO_CAP);
    useBucketStore.getState().removeMany(["k:missing", "k:a"]);
    expect(useBucketStore.getState().order).toEqual([]);
  });

  test("removeMany is a no-op when called with an empty array", () => {
    useBucketStore.getState().addMany([makeItem("k:a"), makeItem("k:b")], NO_CAP);
    useBucketStore.getState().removeMany([]);
    expect(useBucketStore.getState().order).toEqual(["k:a", "k:b"]);
  });

  test("clear empties everything", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b")], NO_CAP);
    useBucketStore.getState().clear();
    const state = useBucketStore.getState();
    expect(state.order).toHaveLength(0);
    expect(Object.keys(state.items)).toHaveLength(0);
  });

  test("updateStatus patches an existing item without reordering", () => {
    const a = makeItem("k:a", { status: "uploading" });
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b], NO_CAP);
    useBucketStore
      .getState()
      .updateStatus("k:a", { status: "ready" });
    const state = useBucketStore.getState();
    expect(state.items["k:a"].status).toBe("ready");
    expect(state.order).toEqual(["k:a", "k:b"]);
  });

  test("updateStatus does not regress a ready item to uploading", () => {
    const a = makeItem("k:a", { status: "ready" });
    useBucketStore.getState().addMany([a], NO_CAP);
    useBucketStore
      .getState()
      .updateStatus("k:a", { status: "uploading" });
    expect(useBucketStore.getState().items["k:a"].status).toBe("ready");
  });

  test("updateStatus is a no-op for unknown keys", () => {
    useBucketStore.getState().addMany([makeItem("k:a")], NO_CAP);
    useBucketStore.getState().updateStatus("k:missing", { status: "failed" });
    expect(useBucketStore.getState().order).toEqual(["k:a"]);
  });

  test("addMany does not regress status when an existing ready item is re-added as uploading", () => {
    useBucketStore.getState().addMany([makeItem("k:a", { status: "ready" })], NO_CAP);
    useBucketStore
      .getState()
      .addMany([makeItem("k:a", { status: "uploading" })], NO_CAP);
    expect(useBucketStore.getState().items["k:a"].status).toBe("ready");
  });

  test("persists to localStorage and rehydrates the same items/order", () => {
    useBucketStore.getState().addMany([makeItem("k:a"), makeItem("k:b")], NO_CAP);

    const raw = window.localStorage.getItem("extraction-bucket");
    expect(raw).not.toBeNull();

    const snapshot = JSON.parse(raw!) as {
      state: { items: Record<string, BucketItem>; order: string[] };
    };
    expect(snapshot.state.order).toEqual(["k:a", "k:b"]);
    expect(snapshot.state.items["k:a"].bucketKey).toBe("k:a");
  });
});

describe("useBucketStore — updatePaperCount", () => {
  // Mirrors the bucket-indicator's derived math so each test can assert
  // the indicator stays consistent with the store mutation.
  const computeReadyCount = () => {
    const state = useBucketStore.getState();
    return state.order.reduce((n, k) => {
      const item = state.items[k];
      return item?.status === "ready" ? n + (item.paperCount ?? 1) : n;
    }, 0);
  };

  test("updates paperCount for a staged history item", () => {
    useBucketStore
      .getState()
      .addMany(
        [makeItem("history:h1", { paperCount: 500 })],
        1000,
      );
    expect(computeReadyCount()).toBe(500);
    useBucketStore.getState().updatePaperCount("history:h1", 200, 200);
    expect(useBucketStore.getState().items["history:h1"].paperCount).toBe(
      200,
    );
    expect(computeReadyCount()).toBe(200);
  });

  test("clamps nextCount down to cap when it exceeds cap", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("history:h1", { paperCount: 100 })], 1000);
    useBucketStore.getState().updatePaperCount("history:h1", 250, 200);
    expect(useBucketStore.getState().items["history:h1"].paperCount).toBe(
      200,
    );
  });

  test("clamps nextCount up to zero when it is negative", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("history:h1", { paperCount: 100 })], 1000);
    useBucketStore.getState().updatePaperCount("history:h1", -5, 200);
    expect(useBucketStore.getState().items["history:h1"].paperCount).toBe(0);
  });

  test("floors a fractional nextCount to an integer", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("history:h1", { paperCount: 100 })], 1000);
    useBucketStore.getState().updatePaperCount("history:h1", 99.7, 200);
    expect(useBucketStore.getState().items["history:h1"].paperCount).toBe(99);
  });

  test("is a no-op for an unknown bucketKey", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("history:h1", { paperCount: 100 })], 1000);
    const before = useBucketStore.getState();
    useBucketStore.getState().updatePaperCount("history:missing", 50, 200);
    const after = useBucketStore.getState();
    expect(after.items).toBe(before.items);
    expect(after.order).toBe(before.order);
  });

  test("updates paperCount on an uploading item but keeps it out of readyCount", () => {
    useBucketStore
      .getState()
      .addMany(
        [
          makeItem("history:h1", {
            status: "uploading",
            paperCount: 100,
          }),
        ],
        1000,
      );
    expect(computeReadyCount()).toBe(0);
    useBucketStore.getState().updatePaperCount("history:h1", 250, 200);
    expect(useBucketStore.getState().items["history:h1"].paperCount).toBe(
      200,
    );
    expect(computeReadyCount()).toBe(0);
  });

  test("readyCount updates when status flips from uploading to ready", () => {
    useBucketStore
      .getState()
      .addMany(
        [
          makeItem("history:h1", {
            status: "uploading",
            paperCount: 100,
          }),
        ],
        1000,
      );
    useBucketStore.getState().updatePaperCount("history:h1", 150, 200);
    expect(computeReadyCount()).toBe(0);
    useBucketStore
      .getState()
      .updateStatus("history:h1", { status: "ready" });
    expect(computeReadyCount()).toBe(150);
  });

  test("no-op when the clamped value equals the existing paperCount", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("history:h1", { paperCount: 100 })], 1000);
    const before = useBucketStore.getState().items;
    useBucketStore.getState().updatePaperCount("history:h1", 100, 200);
    expect(useBucketStore.getState().items).toBe(before);
  });
});

describe("useBucketStore — dedupeKeys / dedupeKeyToSource", () => {
  test("addMany populates weak dedupe keys from doi/title+year", () => {
    useBucketStore
      .getState()
      .addMany(
        [
          makeItem("openalex:W1", {
            source: "library",
            doi: "10.1/a",
            title: "Alpha",
            year: 2020,
          }),
        ],
        NO_CAP,
      );
    const { dedupeKeys, dedupeKeyToSource } = useBucketStore.getState();
    expect(dedupeKeys.has("doi:10.1/a")).toBe(true);
    expect(dedupeKeyToSource["doi:10.1/a"]).toBe("library");
  });

  test("dedupeKeyToSource lets Zotero rows cross-match a library-staged paper", () => {
    // Library row has both openalexId (bucketKey) and DOI; Zotero would
    // key the same paper by DOI. The weak dedupe key (doi:…) collapses
    // the two so the Zotero tab can show "also staged from Library".
    useBucketStore.getState().addMany(
      [
        makeItem("openalex:W42", {
          source: "library",
          doi: "10.1/shared",
          title: "Shared Paper",
          year: 2021,
        }),
      ],
      NO_CAP,
    );
    const { dedupeKeys, dedupeKeyToSource, order } = useBucketStore.getState();
    expect(order).toEqual(["openalex:W42"]);
    expect(dedupeKeys.has("doi:10.1/shared")).toBe(true);
    expect(dedupeKeyToSource["doi:10.1/shared"]).toBe("library");
  });

  test("saved-search placeholders do NOT contribute to dedupe maps", () => {
    useBucketStore.getState().addMany(
      [
        makeItem("history:h1", {
          source: "history",
          sourceMeta: { isSavedSearch: true },
          title: "neural networks",
        }),
      ],
      NO_CAP,
    );
    const { dedupeKeys } = useBucketStore.getState();
    expect(dedupeKeys.size).toBe(0);
  });

  test("remove prunes the weak key when the last item carrying it leaves", () => {
    useBucketStore.getState().addMany(
      [
        makeItem("openalex:W1", {
          doi: "10.1/x",
          title: "X",
          year: 2020,
        }),
      ],
      NO_CAP,
    );
    useBucketStore.getState().remove("openalex:W1");
    const { dedupeKeys, dedupeKeyToSource } = useBucketStore.getState();
    expect(dedupeKeys.size).toBe(0);
    expect(Object.keys(dedupeKeyToSource)).toHaveLength(0);
  });

  test("removeMany rebuilds dedupe maps from the surviving items", () => {
    useBucketStore.getState().addMany(
      [
        makeItem("openalex:W1", {
          source: "library",
          doi: "10.1/a",
          title: "A",
          year: 2020,
        }),
        makeItem("doi:10.1/b", {
          source: "zotero",
          doi: "10.1/b",
          title: "B",
          year: 2021,
        }),
      ],
      NO_CAP,
    );
    useBucketStore.getState().removeMany(["openalex:W1"]);
    const { dedupeKeys, dedupeKeyToSource } = useBucketStore.getState();
    expect(Array.from(dedupeKeys)).toEqual(["doi:10.1/b"]);
    expect(dedupeKeyToSource["doi:10.1/b"]).toBe("zotero");
    expect(dedupeKeyToSource["doi:10.1/a"]).toBeUndefined();
  });

  test("clear empties the dedupe maps too", () => {
    useBucketStore
      .getState()
      .addMany(
        [makeItem("openalex:W1", { doi: "10.1/x", title: "X", year: 2020 })],
        NO_CAP,
      );
    useBucketStore.getState().clear();
    const { dedupeKeys, dedupeKeyToSource } = useBucketStore.getState();
    expect(dedupeKeys.size).toBe(0);
    expect(Object.keys(dedupeKeyToSource)).toHaveLength(0);
  });

  test("two items with different bucketKeys but the same doi share one dedupe key", () => {
    // Edge case: user stages the same paper from both sources (the
    // cross-source dedup hint is meant to prevent this, but if it
    // happens the weak key stays in the map until the last carrier
    // leaves).
    useBucketStore.getState().addMany(
      [
        makeItem("openalex:W9", {
          source: "library",
          doi: "10.1/shared",
          title: "Shared",
          year: 2020,
        }),
        makeItem("doi:10.1/shared", {
          source: "zotero",
          doi: "10.1/shared",
          title: "Shared",
          year: 2020,
        }),
      ],
      NO_CAP,
    );
    useBucketStore.getState().remove("openalex:W9");
    const { dedupeKeys, dedupeKeyToSource } = useBucketStore.getState();
    expect(dedupeKeys.has("doi:10.1/shared")).toBe(true);
    expect(dedupeKeyToSource["doi:10.1/shared"]).toBe("zotero");
  });
});
