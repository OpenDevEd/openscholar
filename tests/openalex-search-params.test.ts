import { describe, it, expect } from "vitest";
import { buildOpenAlexSearchParams } from "../lib/openalex/search-params";

/**
 * Pure tests for buildOpenAlexSearchParams — the query-string builder
 * lifted out of convex/extraction/actions.ts. No fetch, no env. Only
 * input → URLSearchParams shape.
 */

describe("buildOpenAlexSearchParams — search field routing", () => {
  it("defaults to the free-text `search` param when no searchField is given", () => {
    const p = buildOpenAlexSearchParams({ query: "ebola" });
    expect(p.get("search")).toBe("ebola");
    expect(p.get("filter")).toBeNull();
  });

  it("maps searchField='title' to filter=title.search:<q>", () => {
    const p = buildOpenAlexSearchParams({ query: "hiv", searchField: "title" });
    expect(p.get("filter")).toBe("title.search:hiv");
  });

  it("maps searchField='abstract' to filter=abstract.search:<q>", () => {
    const p = buildOpenAlexSearchParams({ query: "vaccine", searchField: "abstract" });
    expect(p.get("filter")).toBe("abstract.search:vaccine");
  });

  it("maps searchField='title_and_abstract' to filter=title_and_abstract.search:<q>", () => {
    const p = buildOpenAlexSearchParams({ query: "covid", searchField: "title_and_abstract" });
    expect(p.get("filter")).toBe("title_and_abstract.search:covid");
  });

  it("maps searchField='fulltext' to filter=fulltext.search:<q>", () => {
    const p = buildOpenAlexSearchParams({ query: "cancer", searchField: "fulltext" });
    expect(p.get("filter")).toBe("fulltext.search:cancer");
  });

  it("maps searchField='display_name' to filter=display_name.search:<q>", () => {
    const p = buildOpenAlexSearchParams({ query: "malaria", searchField: "display_name" });
    expect(p.get("filter")).toBe("display_name.search:malaria");
  });
});

describe("buildOpenAlexSearchParams — year and date filters", () => {
  it("serializes yearRange when no dateRange is given", () => {
    const p = buildOpenAlexSearchParams({ query: "q", yearRange: [2020, 2024] });
    expect(p.get("filter")).toContain("publication_year:2020-2024");
  });

  it("prefers dateRange.from over yearRange when both are present", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      yearRange: [2020, 2024],
      dateRange: { from: "2023-01-01" },
    });
    expect(p.get("filter")).toContain("from_publication_date:2023-01-01");
    expect(p.get("filter")).not.toContain("publication_year:2020-2024");
  });

  it("emits both from and to date filters when supplied", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      dateRange: { from: "2023-01-01", to: "2024-12-31" },
    });
    expect(p.get("filter")).toContain("from_publication_date:2023-01-01");
    expect(p.get("filter")).toContain("to_publication_date:2024-12-31");
  });
});

describe("buildOpenAlexSearchParams — review + geography filters", () => {
  it("adds type:review when reviewFilter is true", () => {
    const p = buildOpenAlexSearchParams({ query: "q", reviewFilter: true });
    expect(p.get("filter")).toContain("type:review");
  });

  it("pipe-joins countries via countries:<a>|<b>", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      selectedCountryFocus: ["US", "KE", "ZA"],
    });
    expect(p.get("filter")).toContain("countries:US|KE|ZA");
  });

  it("pipe-joins regions via regions:<a>|<b>", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      selectedRegions: ["africa", "asia"],
    });
    expect(p.get("filter")).toContain("regions:africa|asia");
  });

  it("skips geography filters when arrays are empty", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      selectedCountryFocus: [],
      selectedRegions: [],
    });
    expect(p.get("filter")).toBeNull();
  });
});

describe("buildOpenAlexSearchParams — relationship filters (cites / cited_by / related_to)", () => {
  it("prefixes cites id with https://openalex.org/ when missing", () => {
    const p = buildOpenAlexSearchParams({ query: "q", citesItemId: "W1234" });
    expect(p.get("filter")).toContain("cites:https://openalex.org/W1234");
  });

  it("leaves fully-qualified cites id alone", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      citesItemId: "https://openalex.org/W5678",
    });
    expect(p.get("filter")).toContain("cites:https://openalex.org/W5678");
  });

  it("handles cited_by and related_to the same way", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      citedByItemId: "W1",
      relatedToItemId: "W2",
    });
    const filter = p.get("filter") ?? "";
    expect(filter).toContain("cited_by:https://openalex.org/W1");
    expect(filter).toContain("related_to:https://openalex.org/W2");
  });
});

describe("buildOpenAlexSearchParams — sort + pagination", () => {
  it("defaults sort direction to desc when sortBy is just a field", () => {
    const p = buildOpenAlexSearchParams({ query: "q", sortBy: "cited_by_count" });
    expect(p.get("sort")).toBe("cited_by_count:desc");
  });

  it("preserves explicit sort direction", () => {
    const p = buildOpenAlexSearchParams({ query: "q", sortBy: "publication_date:asc" });
    expect(p.get("sort")).toBe("publication_date:asc");
  });

  it("always sets per-page=200", () => {
    const p = buildOpenAlexSearchParams({ query: "q" });
    expect(p.get("per-page")).toBe("200");
  });
});

describe("buildOpenAlexSearchParams — filter composition", () => {
  it("comma-joins multiple filters in a single filter= param", () => {
    const p = buildOpenAlexSearchParams({
      query: "q",
      searchField: "title",
      yearRange: [2020, 2024],
      reviewFilter: true,
    });
    const filter = p.get("filter") ?? "";
    expect(filter.split(",")).toEqual([
      "title.search:q",
      "publication_year:2020-2024",
      "type:review",
    ]);
  });

  it("emits no filter param when only a free-text query is given", () => {
    const p = buildOpenAlexSearchParams({ query: "q" });
    expect(p.get("filter")).toBeNull();
    expect(p.get("search")).toBe("q");
  });
});
