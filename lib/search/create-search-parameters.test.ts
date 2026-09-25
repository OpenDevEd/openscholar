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
  researchAreas: [],
  sdgs: [],
  openAccessOnly: false,
  workTypes: [],
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

describe("createSearchParameters research, goal, access and type filters", () => {
  it("adds them alongside the query, date and institution filters", () => {
    const params = createSearchParameters("education", {
      ...baseFilters,
      yearRange: [2020, 2025],
      selectedRegions: ["GB"],
      researchAreas: ["subfields/3304", "subfields/1702", "T10001"],
      sdgs: ["4"],
      openAccessOnly: true,
      workTypes: ["article", "review"],
    });

    expect(params.filter).toEqual({
      title_and_abstract: { search: "education" },
      from_publication_date: "2020-01-01",
      to_publication_date: "2025-12-31",
      authorships: { countries: "GB" },
      topics: { subfield: { id: "3304|1702" }, id: "T10001" },
      sustainable_development_goals: { id: "https://metadata.un.org/sdg/4" },
      open_access: { is_oa: true },
      type: "article|review",
    });
  });

  it("supports an empty query scoped only by a research area", () => {
    const params = createSearchParameters("", { ...baseFilters, researchAreas: ["T10001"] });

    expect(params.filter).toEqual({ topics: { id: "T10001" } });
    expect(params.search).toBeUndefined();
  });
});
