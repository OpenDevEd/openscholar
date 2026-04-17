import { describe, expect, test, vi } from "vitest";
import { collectAllPages, type PageLike } from "@/lib/zotero/collect-all-pages";

type Item = { key: string };
type Page = PageLike<Item>;

function page(items: string[], hasMore: boolean): Page {
  return { items: items.map((key) => ({ key })), hasMore };
}

describe("collectAllPages", () => {
  test("returns the initial pages untouched when hasMore is already false", async () => {
    const fetchNext = vi.fn();
    const res = await collectAllPages<Item, Page>({
      initialPages: [page(["a", "b"], false)],
      fetchNext,
      cap: 1000,
      isCancelled: () => false,
    });
    expect(fetchNext).not.toHaveBeenCalled();
    expect(res.pages.map((p) => p.items.map((i) => i.key))).toEqual([
      ["a", "b"],
    ]);
    expect(res.truncated).toBe(false);
    expect(res.cancelled).toBe(false);
  });

  test("drives setSize until the final page reports hasMore=false", async () => {
    const allPages: Page[][] = [
      [page(["a"], true)],
      [page(["a"], true), page(["b"], true)],
      [page(["a"], true), page(["b"], true), page(["c"], false)],
    ];
    const fetchNext = vi.fn(async (size: number) => allPages[size - 1]);
    const res = await collectAllPages<Item, Page>({
      initialPages: allPages[0],
      fetchNext,
      cap: 1000,
      isCancelled: () => false,
    });
    expect(fetchNext).toHaveBeenCalledTimes(2);
    expect(fetchNext).toHaveBeenNthCalledWith(1, 2);
    expect(fetchNext).toHaveBeenNthCalledWith(2, 3);
    expect(res.pages.flatMap((p) => p.items.map((i) => i.key))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(res.truncated).toBe(false);
    expect(res.cancelled).toBe(false);
  });

  test("stops early when cap would be reached and flags truncated", async () => {
    const allPages: Page[][] = [
      [page(["a", "b"], true)],
      [page(["a", "b"], true), page(["c", "d"], true)],
      [
        page(["a", "b"], true),
        page(["c", "d"], true),
        page(["e", "f"], true),
      ],
    ];
    const fetchNext = vi.fn(async (size: number) => allPages[size - 1]);
    const res = await collectAllPages<Item, Page>({
      initialPages: allPages[0],
      fetchNext,
      cap: 5,
      isCancelled: () => false,
    });
    expect(res.pages.flatMap((p) => p.items).length).toBeGreaterThanOrEqual(5);
    expect(res.truncated).toBe(true);
    expect(res.cancelled).toBe(false);
  });

  test("cancel mid-loop stops after the in-flight page and flags cancelled", async () => {
    let cancelled = false;
    const allPages: Page[][] = [
      [page(["a"], true)],
      [page(["a"], true), page(["b"], true)],
      [page(["a"], true), page(["b"], true), page(["c"], true)],
    ];
    const fetchNext = vi.fn(async (size: number) => {
      // Flip cancel after the first extra page lands so the loop sees
      // `cancelled` on its next iteration.
      if (size === 2) cancelled = true;
      return allPages[size - 1];
    });
    const res = await collectAllPages<Item, Page>({
      initialPages: allPages[0],
      fetchNext,
      cap: 1000,
      isCancelled: () => cancelled,
    });
    expect(fetchNext).toHaveBeenCalledTimes(1);
    expect(res.cancelled).toBe(true);
    expect(res.truncated).toBe(false);
  });

  test("breaks out on fetchNext returning the same page count (stall)", async () => {
    const stall: Page[] = [page(["a"], true)];
    const fetchNext = vi.fn(async () => stall);
    const res = await collectAllPages<Item, Page>({
      initialPages: stall,
      fetchNext,
      cap: 1000,
      isCancelled: () => false,
    });
    expect(fetchNext).toHaveBeenCalledTimes(1);
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].items.map((i) => i.key)).toEqual(["a"]);
    expect(res.cancelled).toBe(false);
    // Server still says hasMore=true, but we made no progress — treat as
    // a soft failure, not a truncation. (Truncation = we stopped because
    // of our cap, not because of the server.)
    expect(res.truncated).toBe(false);
  });

  test("breaks out on fetchNext returning undefined", async () => {
    const fetchNext = vi.fn(async () => undefined);
    const res = await collectAllPages<Item, Page>({
      initialPages: [page(["a"], true)],
      fetchNext,
      cap: 1000,
      isCancelled: () => false,
    });
    expect(fetchNext).toHaveBeenCalledTimes(1);
    expect(res.pages.flatMap((p) => p.items.map((i) => i.key))).toEqual(["a"]);
  });

  test("is a no-op when initial pages already exceed the cap", async () => {
    const fetchNext = vi.fn();
    const res = await collectAllPages<Item, Page>({
      initialPages: [page(["a", "b", "c", "d", "e", "f"], true)],
      fetchNext,
      cap: 5,
      isCancelled: () => false,
    });
    expect(fetchNext).not.toHaveBeenCalled();
    expect(res.truncated).toBe(true);
  });
});
