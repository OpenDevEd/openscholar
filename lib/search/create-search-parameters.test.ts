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
