import { describe, expect, test } from "vitest";
import { buildDedupeKey } from "@/lib/bucket/dedupe";

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

  test("accepts a bare W-id for openalexId", () => {
    expect(buildDedupeKey({ openalexId: "W42" })).toBe("openalex:W42");
  });

  test("throws when none of openalexId, doi, or title is provided", () => {
    expect(() => buildDedupeKey({})).toThrow();
    expect(() => buildDedupeKey({ year: 2020 })).toThrow();
  });
});
