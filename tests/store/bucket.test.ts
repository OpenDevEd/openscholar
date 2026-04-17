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

describe("useBucketStore", () => {
  test("addMany adds items in insertion order", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b]);
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:a", "k:b"]);
    expect(state.items[a.bucketKey]).toEqual(a);
    expect(state.items[b.bucketKey]).toEqual(b);
  });

  test("addMany dedupes on bucketKey without reordering", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b]);
    useBucketStore.getState().addMany([a]);
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:a", "k:b"]);
  });

  test("remove drops one key and leaves the rest", () => {
    const a = makeItem("k:a");
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b]);
    useBucketStore.getState().remove("k:a");
    const state = useBucketStore.getState();
    expect(state.order).toEqual(["k:b"]);
    expect(state.items["k:a"]).toBeUndefined();
  });

  test("clear empties everything", () => {
    useBucketStore
      .getState()
      .addMany([makeItem("k:a"), makeItem("k:b")]);
    useBucketStore.getState().clear();
    const state = useBucketStore.getState();
    expect(state.order).toHaveLength(0);
    expect(Object.keys(state.items)).toHaveLength(0);
  });

  test("updateStatus patches an existing item without reordering", () => {
    const a = makeItem("k:a", { status: "uploading" });
    const b = makeItem("k:b");
    useBucketStore.getState().addMany([a, b]);
    useBucketStore
      .getState()
      .updateStatus("k:a", { status: "ready" });
    const state = useBucketStore.getState();
    expect(state.items["k:a"].status).toBe("ready");
    expect(state.order).toEqual(["k:a", "k:b"]);
  });

  test("updateStatus does not regress a ready item to uploading", () => {
    const a = makeItem("k:a", { status: "ready" });
    useBucketStore.getState().addMany([a]);
    useBucketStore
      .getState()
      .updateStatus("k:a", { status: "uploading" });
    expect(useBucketStore.getState().items["k:a"].status).toBe("ready");
  });

  test("updateStatus is a no-op for unknown keys", () => {
    useBucketStore.getState().addMany([makeItem("k:a")]);
    useBucketStore.getState().updateStatus("k:missing", { status: "failed" });
    expect(useBucketStore.getState().order).toEqual(["k:a"]);
  });

  test("addMany does not regress status when an existing ready item is re-added as uploading", () => {
    useBucketStore.getState().addMany([makeItem("k:a", { status: "ready" })]);
    useBucketStore
      .getState()
      .addMany([makeItem("k:a", { status: "uploading" })]);
    expect(useBucketStore.getState().items["k:a"].status).toBe("ready");
  });

  test("persists to localStorage and rehydrates the same items/order", () => {
    useBucketStore.getState().addMany([makeItem("k:a"), makeItem("k:b")]);

    const raw = window.localStorage.getItem("extraction-bucket");
    expect(raw).not.toBeNull();

    const snapshot = JSON.parse(raw!) as {
      state: { items: Record<string, BucketItem>; order: string[] };
    };
    expect(snapshot.state.order).toEqual(["k:a", "k:b"]);
    expect(snapshot.state.items["k:a"].bucketKey).toBe("k:a");
  });
});
