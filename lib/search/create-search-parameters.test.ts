import { describe, it, expect } from "vitest";
import { createSearchParameters } from "@/lib/utils";
import type { SearchFilters } from "@/lib/types";

const baseFilters: SearchFilters = {
  searchField: "title_and_abstract",
  sortBy: "relevance_score:desc",
  filterType: "year",
  selectedRegions: [],
  selectedCountryFocus: [],
  citesItemId: "",
  citedByItemId: "",
  relatedToItemId: "",
  reviewFilter: false,
};

describe("createSearchParameters — wildcard field routing", () => {
  it("uses the stemmed title_and_abstract.search for a plain query", () => {
    const params = createSearchParameters("machine learning", baseFilters);
    expect(params.filter).toMatchObject({
      title_and_abstract: { search: "machine learning" },
    });
  });

  it("routes an unquoted wildcard query to title_and_abstract.search.exact", () => {
    const params = createSearchParameters(
      '(AI OR "artificial intelligence") AND (impact OR transform* OR evolution)',
      baseFilters
    );
    expect(params.filter).toMatchObject({
      title_and_abstract: {
        search: {
          exact:
            '(AI OR "artificial intelligence") AND (impact OR transform* OR evolution)',
        },
      },
    });
  });

  it("keeps the stemmed field when the wildcard is only inside a quoted phrase", () => {
    const params = createSearchParameters('"transform*"', baseFilters);
    expect(params.filter).toMatchObject({
      title_and_abstract: { search: '"transform*"' },
    });
  });
});

describe("createSearchParameters source filters", () => {
  it("retains query, date and institution filters alongside nested source filters", () => {
    const params = createSearchParameters("education", {
      ...baseFilters,
      yearRange: [2020, 2025],
      selectedRegions: ["GB"],
      extraApiFilters: {
        topics: { subfield: { id: "3304" } },
        open_access: { is_oa: true },
        sustainable_development_goals: { id: "4" },
      },
    });

    expect(params.filter).toEqual({
      title_and_abstract: { search: "education" },
      from_publication_date: "2020-01-01",
      to_publication_date: "2025-12-31",
      authorships: { countries: "GB" },
      topics: { subfield: { id: "3304" } },
      open_access: { is_oa: true },
      sustainable_development_goals: { id: "4" },
    });
  });
  it("supports an empty query scoped only by source filters", () => {
    const params = createSearchParameters("", {
      ...baseFilters,
      extraApiFilters: { topics: { id: "T10001" } },
    });

    expect(params.filter).toEqual({ topics: { id: "T10001" } });
    expect(params.search).toBeUndefined();
  });

});
