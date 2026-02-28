import { describe, expect, it } from "vitest";
import {
  searchParamsParsers,
  serializeSearchParams,
  parseAsRegions,
  DEFAULT_SEARCH_PARAMS,
} from "../lib/search-params/parsers";

describe("parseAsRegions round-trip", () => {
  it("serializes empty array to empty string", () => {
    expect(parseAsRegions.serialize([])).toBe("");
  });

  it("parses empty string to empty array", () => {
    expect(parseAsRegions.parse("")).toEqual([]);
  });

  it("round-trips single region", () => {
    const serialized = parseAsRegions.serialize(["africa"]);
    expect(serialized).toBe("AF");
    const parsed = parseAsRegions.parse(serialized!);
    expect(parsed).toContain("africa");
  });

  it("round-trips multiple regions and countries", () => {
    const original = ["africa", "US", "europe"];
    const serialized = parseAsRegions.serialize(original);
    const parsed = parseAsRegions.parse(serialized!);
    expect(parsed).toContain("africa");
    expect(parsed).toContain("US");
    expect(parsed).toContain("europe");
  });
});

describe("serializeSearchParams", () => {
  it("produces a non-empty query string for default params", () => {
    const result = serializeSearchParams(DEFAULT_SEARCH_PARAMS);
    expect(result).toBeTruthy();
    expect(result).toContain("q=");
    expect(result).toContain("field=");
  });

  it("serializes custom query", () => {
    const result = serializeSearchParams({
      ...DEFAULT_SEARCH_PARAMS,
      q: "machine learning",
    });
    // URL encoding can use + or %20 for spaces
    expect(result).toMatch(/q=machine[\+%20]learning/);
  });

  it("serializes year filters", () => {
    const result = serializeSearchParams({
      ...DEFAULT_SEARCH_PARAMS,
      yf: 2020,
      yt: 2024,
    });
    expect(result).toContain("yf=2020");
    expect(result).toContain("yt=2024");
  });

  it("serializes region filter via parseAsRegions", () => {
    const result = serializeSearchParams({
      ...DEFAULT_SEARCH_PARAMS,
      reg: ["africa", "US"],
    });
    // The region encoder produces "AF,US", which may be URL-encoded
    expect(result).toMatch(/reg=AF[,%2C]US/);
  });

  it("serializes boolean filter", () => {
    const result = serializeSearchParams({
      ...DEFAULT_SEARCH_PARAMS,
      review: true,
    });
    expect(result).toContain("review=true");
  });
});

describe("searchParamsParsers individual parsers", () => {
  it("q parser has default empty string", () => {
    // Default value is empty string
    expect(searchParamsParsers.q.defaultValue).toBe("");
  });

  it("page parser has default 1", () => {
    expect(searchParamsParsers.page.defaultValue).toBe(1);
  });

  it("rated parser has default false", () => {
    expect(searchParamsParsers.rated.defaultValue).toBe(false);
  });

  it("field parser has default title_and_abstract", () => {
    expect(searchParamsParsers.field.defaultValue).toBe("title_and_abstract");
  });

  it("sort parser has default relevance_score:desc", () => {
    expect(searchParamsParsers.sort.defaultValue).toBe("relevance_score:desc");
  });

  it("reg parser has default empty array", () => {
    expect(searchParamsParsers.reg.defaultValue).toEqual([]);
  });

  it("focus parser has default empty array", () => {
    expect(searchParamsParsers.focus.defaultValue).toEqual([]);
  });

  it("review parser has default false", () => {
    expect(searchParamsParsers.review.defaultValue).toBe(false);
  });
});
