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
  workLanguages: [],
  institutionTypes: [],
  funders: [],
  authors: [],
  minCitations: null,
  hasAbstract: false,
  includeRetracted: false,
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

describe("createSearchParameters language, institution, funder, author, citation and abstract filters", () => {
  it("adds them in the SDK's form, keeping institution location beside institution type", () => {
    const params = createSearchParameters("", {
      ...baseFilters,
      selectedRegions: ["KE"],
      workLanguages: ["en", "fr"],
      institutionTypes: ["government"],
      funders: ["F4320311904"],
      authors: ["A5023888391", "A5100000001"],
      minCitations: 10,
      hasAbstract: true,
      includeRetracted: true,
    });

    expect(params.filter).toEqual({
      authorships: { countries: "KE", institutions: { type: "government" }, author: { id: "A5023888391|A5100000001" } },
      language: "en|fr",
      funders: { id: "F4320311904" },
      cited_by_count: ">9",
      has_abstract: true,
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
      is_retracted: false,
    });
  });

  it("supports an empty query scoped only by a research area", () => {
    const params = createSearchParameters("", { ...baseFilters, researchAreas: ["T10001"] });

    expect(params.filter).toEqual({ topics: { id: "T10001" }, is_retracted: false });
    expect(params.search).toBeUndefined();
  });
});

describe("createSearchParameters — search by meaning", () => {
  it("asks the question by meaning, keeps the filters, and sorts by relevance alone", () => {
    const params = createSearchParameters("Does exercise help with depression?", {
      ...baseFilters,
      searchField: "semantic",
      sortBy: "cited_by_count:desc",
      openAccessOnly: true,
    });
    expect(params.semantic).toBe("Does exercise help with depression?");
    expect(params.search).toBeUndefined();
    expect(Object.keys(params.filter ?? {}).filter((key) => key.includes("search") || key === "title_and_abstract")).toEqual([]);
    expect(params.filter).toEqual(createSearchParameters("", { ...baseFilters, openAccessOnly: true }).filter);
    expect(params.sortBy).toEqual({ field: "relevance_score", order: "desc" });
  });

  it("looks for country focus and reviews in the title and abstract, beside the question as typed", () => {
    const question = "What helps teachers stay in rural schools?";
    const focused = { ...baseFilters, searchField: "semantic" as const, selectedCountryFocus: ["KE"], reviewFilter: true };
    const params = createSearchParameters(question, focused);
    expect(params.semantic).toBe(question);
    expect(params.filter?.title_and_abstract).toEqual({ search: '("Kenya") AND (review OR synthesis OR "meta-analysis")' });
    expect(createSearchParameters(question, { ...focused, selectedCountryFocus: [] }).filter?.title_and_abstract).toEqual({ search: '(review OR synthesis OR "meta-analysis")' });
    // Without a question they still narrow the list, as they do a keyword search's.
    const listed = createSearchParameters("", { ...focused, reviewFilter: false });
    expect([listed.semantic, listed.filter?.title_and_abstract]).toEqual([undefined, { search: '("Kenya")' }]);
  });

  it("asks the question without the spaces around it, and nothing for spaces alone", () => {
    const semantic = { ...baseFilters, searchField: "semantic" as const };
    expect(createSearchParameters("  Does tutoring help?  ", semantic).semantic).toBe("Does tutoring help?");
    // As the results page reads it: a list of what country focus keeps, not a question the API refuses.
    const spaces = createSearchParameters("   ", { ...semantic, selectedCountryFocus: ["KE"] });
    expect([spaces.semantic, spaces.filter?.title_and_abstract]).toEqual([undefined, { search: '("Kenya")' }]);
  });

  it("asks for the works nearest given papers, beside every filter, by relevance alone", () => {
    const params = createSearchParameters("", {
      ...baseFilters,
      similarTo: ["OS64233829", "OS14687712"],
      sortBy: "publication_date:desc",
      openAccessOnly: true,
    });
    expect([params.similar, params.semantic, params.search]).toEqual(["OS64233829|OS14687712", undefined, undefined]);
    expect(params.filter).toEqual(createSearchParameters("", { ...baseFilters, openAccessOnly: true }).filter);
    expect(params.sortBy).toEqual({ field: "relevance_score", order: "desc" });
    expect(createSearchParameters("", { ...baseFilters, similarTo: [] }).similar).toBeUndefined();
  });

  it("asks a question by meaning without the papers an address or a saved search names beside it", () => {
    const params = createSearchParameters("kelp forests", { ...baseFilters, searchField: "semantic", similarTo: ["OS64233829"] });
    expect([params.semantic, params.similar]).toEqual(["kelp forests", undefined]);
  });

  it("asks nothing by meaning without a question, and keeps the sort chosen", () => {
    const params = createSearchParameters("", { ...baseFilters, searchField: "semantic", sortBy: "publication_date:desc" });
    expect(params.semantic).toBeUndefined();
    expect(params.sortBy).toEqual({ field: "publication_date", order: "desc" });
  });
});
