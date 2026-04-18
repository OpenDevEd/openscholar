import { describe, expect, test } from "vitest";
import type { BucketItem } from "@/lib/bucket/bucketItem";
import { authorsPreview } from "@/lib/bucket/authors-preview";

function item(overrides: Partial<BucketItem> = {}): BucketItem {
  return {
    bucketKey: "k",
    source: "library",
    sourceRefId: "k",
    title: "t",
    authors: [],
    addedAt: 1,
    status: "ready",
    ...overrides,
  };
}

describe("authorsPreview", () => {
  test("saved-search placeholder shows paper-count noun, not Unknown", () => {
    expect(
      authorsPreview(
        item({
          source: "history",
          sourceMeta: { isSavedSearch: true },
          paperCount: 42,
        }),
      ),
    ).toBe("42 papers");
  });

  test("saved-search with 1 paper uses singular noun", () => {
    expect(
      authorsPreview(
        item({
          source: "history",
          sourceMeta: { isSavedSearch: true },
          paperCount: 1,
        }),
      ),
    ).toBe("1 paper");
  });

  test("saved-search without paperCount falls back to 0 papers", () => {
    expect(
      authorsPreview(
        item({
          source: "history",
          sourceMeta: { isSavedSearch: true },
        }),
      ),
    ).toBe("0 papers");
  });

  test("per-paper item: first three authors + year joined with ·", () => {
    expect(
      authorsPreview(
        item({
          authors: ["Smith, J.", "Jones, K.", "Park, L.", "Kim, Y."],
          year: 2024,
        }),
      ),
    ).toBe("Smith, J., Jones, K., Park, L. · 2024");
  });

  test("per-paper item with authors, no year: just authors", () => {
    expect(authorsPreview(item({ authors: ["Doe, J."] }))).toBe("Doe, J.");
  });

  test("per-paper item with year, no authors: just year", () => {
    expect(authorsPreview(item({ authors: [], year: 2020 }))).toBe("2020");
  });

  test("per-paper item with neither: empty string (no Unknown)", () => {
    expect(authorsPreview(item())).toBe("");
  });
});
