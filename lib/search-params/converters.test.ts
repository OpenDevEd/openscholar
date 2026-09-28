import { describe, it, expect } from "vitest";
import { effectiveSort, searchResultToParams } from "./converters";
import { DEFAULT_SEARCH_PARAMS, type ParsedSearchParams } from "./parsers";

describe("searchResultToParams — selection sanitization", () => {
  it("trims and drops empty region codes before they reach the URL params", () => {
    const params = searchResultToParams({
      selectedRegions: ["  us ", "", "uk", "  "],
    });
    expect(params.reg).toEqual(["us", "uk"]);
  });

  it("omits a region selection that is entirely empty/whitespace", () => {
    const params = searchResultToParams({ selectedRegions: ["", "  "] });
    expect(params.reg).toBeUndefined();
  });

  it("trims and keeps country-focus codes", () => {
    const params = searchResultToParams({
      selectedCountryFocus: [" KE ", "TZ"],
    });
    expect(params.focus).toEqual(["KE", "TZ"]);
  });

  it("omits an empty country focus", () => {
    const params = searchResultToParams({ selectedCountryFocus: [] });
    expect(params.focus).toBeUndefined();
  });
});

describe("effectiveSort", () => {
  const params = (o: Partial<ParsedSearchParams>) => ({ ...DEFAULT_SEARCH_PARAMS, ...o });

  // OpenAlex rejects relevance order without a text search (relevance_sort_requires_search).
  it("sorts an OQL query without a text clause newest first", () => {
    expect(effectiveSort(params({ field: "oql", q: "year is (2020) and type is (article)" }))).toBe("publication_date:desc");
    expect(effectiveSort(params({ field: "oql", q: "title has (chatgpt)" }))).toBe("relevance_score:desc");
    expect(effectiveSort(params({ field: "oql", q: "title has chatgpt" }))).toBe("relevance_score:desc");
    expect(effectiveSort(params({ field: "oql", q: "year is (2020)", review: true }))).toBe("relevance_score:desc");
  });

  it("keeps relevance for any keyword query", () => {
    expect(effectiveSort(params({ q: "year" }))).toBe("relevance_score:desc");
    expect(effectiveSort(params({ q: " " }))).toBe("publication_date:desc");
  });
});
