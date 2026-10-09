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

  it("sorts a search by meaning by relevance alone, whatever sort is chosen", () => {
    expect(effectiveSort(params({ field: "semantic", q: "rural teachers", sort: "cited_by_count:desc" }))).toBe("relevance_score:desc");
    expect(effectiveSort(params({ field: "semantic", q: "rural teachers", sort: "relevance_score:desc" }))).toBe("relevance_score:desc");
    // With no question there is nothing to rank: the list sorts as any list without a query does.
    expect(effectiveSort(params({ field: "semantic", q: "  ", sort: "relevance_score:desc" }))).toBe("publication_date:desc");
  });

  it("sorts the works nearest given papers by relevance alone, and keeps them in a saved search", () => {
    expect(effectiveSort(params({ like: ["OS1"], sort: "cited_by_count:desc" }))).toBe("relevance_score:desc");
    expect(searchResultToParams({ similarTo: ["OS1", "OS2"] }).like).toEqual(["OS1", "OS2"]);
    expect(searchResultToParams({ similarTo: [] }).like).toBeUndefined();
  });

  it("sorts a question by meaning or an OQL query as it would without papers named beside it", () => {
    expect(effectiveSort(params({ field: "oql", q: "year is (2020)", like: ["OS1"] }))).toBe("publication_date:desc");
    expect(effectiveSort(params({ field: "semantic", q: "", like: ["OS1"], sort: "cited_by_count:desc" }))).toBe("cited_by_count:desc");
  });

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
