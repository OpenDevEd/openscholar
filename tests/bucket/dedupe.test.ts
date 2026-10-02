import { describe, expect, test } from "vitest";
import { buildDedupeKey, dedupeBucketItems } from "@/lib/bucket/dedupe";

describe("lib/bucket/dedupe", () => {
  test("uses the normalised openalexId when present", () => {
    expect(buildDedupeKey({ openalexId: "https://openalex.org/W1" })).toBe(
      "openalex:W1",
    );
  });

  test("falls back to doi when openalexId is absent", () => {
    expect(buildDedupeKey({ doi: "10.1/abc" })).toBe("doi:10.1/abc");
  });

  test("lowercases doi and strips the https://doi.org/ prefix", () => {
    expect(buildDedupeKey({ doi: "https://doi.org/10.1/ABC" })).toBe(
      "doi:10.1/abc",
    );
  });

  test("falls back to title+year when no id is available", () => {
    expect(buildDedupeKey({ title: "The Foo Bar", year: 2020 })).toBe(
      "title:the foo bar#2020",
    );
  });

  test("normalises whitespace inside titles", () => {
    expect(
      buildDedupeKey({ title: "  The   Foo   Bar  ", year: 2020 }),
    ).toBe("title:the foo bar#2020");
  });

  test("prefers openalexId over doi and title", () => {
    expect(
      buildDedupeKey({
        openalexId: "W42",
        doi: "10.1/x",
        title: "Hello",
        year: 2024,
      }),
    ).toBe("openalex:W42");
  });

  test("prefers doi over title when openalexId is absent", () => {
    expect(
      buildDedupeKey({ doi: "10.1/x", title: "Hello", year: 2024 }),
    ).toBe("doi:10.1/x");
  });

  test("normalises an OpenScholar API id as it does an OpenAlex one", () => {
    expect([
      buildDedupeKey({ openalexId: "https://openscholar.ai/OS1" }),
      buildDedupeKey({ openalexId: "OS1" }),
    ]).toEqual(["openalex:OS1", "openalex:OS1"]);
  });

  test("accepts a bare W-id for openalexId", () => {
    expect(buildDedupeKey({ openalexId: "W42" })).toBe("openalex:W42");
  });

  test("throws when none of openalexId, doi, or title is provided", () => {
    expect(() => buildDedupeKey({})).toThrow();
    expect(() => buildDedupeKey({ year: 2020 })).toThrow();
  });
});

describe("lib/bucket/dedupe.dedupeBucketItems", () => {
  test("collapses two items that share a bucketKey, preserving insertion order (first wins)", () => {
    const a = { bucketKey: "openalex:W1", source: "library", label: "first" };
    const b = { bucketKey: "openalex:W1", source: "history", label: "second" };
    const c = { bucketKey: "openalex:W2", source: "library", label: "third" };
    const out = dedupeBucketItems([a, b, c]);
    expect(out).toEqual([a, c]);
  });

  test("preserves two saved-search placeholders that share a query title but have distinct bucketKeys", () => {
    // Saved-search rows set bucketKey = `history:${savedSearchId}`, so two
    // searches with title="AI ethics" and different filters (yearRange,
    // regions) land with different bucketKeys and must NOT collapse.
    const a = {
      bucketKey: "history:s1",
      source: "history",
      title: "AI ethics",
      searchFilters: { yearRange: [2020, 2024] },
    };
    const b = {
      bucketKey: "history:s2",
      source: "history",
      title: "AI ethics",
      searchFilters: { yearRange: [2015, 2019] },
    };
    expect(dedupeBucketItems([a, b])).toEqual([a, b]);
  });

  test("cross-source paper dedupe still works when both sides produce the same bucketKey", () => {
    // Library and history agree on `openalex:W42` when the same paper is
    // staged from both source tabs — they share a bucketKey and collapse
    // as intended.
    const fromLibrary = { bucketKey: "openalex:W42", source: "library" };
    const fromHistory = { bucketKey: "openalex:W42", source: "history" };
    expect(dedupeBucketItems([fromLibrary, fromHistory])).toEqual([fromLibrary]);
  });

  test("returns an empty array for empty input", () => {
    expect(dedupeBucketItems([])).toEqual([]);
  });
});
