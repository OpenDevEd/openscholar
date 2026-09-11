import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/actions/openalex", () => ({ getSearchResults: vi.fn() }));

import { getSearchResults } from "@/app/actions/openalex";
import { getSearchResultsWithFilters } from "@/lib/search-utils";
import type { SearchFilters } from "@/lib/types";
import { getRegionDisplayName } from "@/lib/i18n/region-names";

const getSearchResultsMock = getSearchResults as unknown as ReturnType<
  typeof vi.fn
>;

const filters: SearchFilters = {
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

describe("getSearchResultsWithFilters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unwraps a successful action result into the SDK data", async () => {
    getSearchResultsMock.mockResolvedValue({
      ok: true,
      data: { results: [], meta: { count: 3 } },
    });
    const out = await getSearchResultsWithFilters({
      query: "machine learning",
      filters,
    });
    expect(out.results).toEqual({ results: [], meta: { count: 3 } });
  });

  it("uses current country names in English while retaining former names in publication searches", async () => {
    expect(getRegionDisplayName("NR", "en-US")).toBe("Naoero");
    getSearchResultsMock.mockResolvedValue({
      ok: true,
      data: { results: [], meta: { count: 0 } },
    });
    const out = await getSearchResultsWithFilters({
      query: "education",
      filters: { ...filters, selectedCountryFocus: ["NR", "CV", "TR"] },
    });
    expect(out.countryNames).toEqual(
      expect.arrayContaining([
        "Naoero",
        "Nauru",
        "Cabo Verde",
        "Cape Verde",
        "Türkiye",
        "Turkey",
      ]),
    );
    expect(getSearchResultsMock.mock.calls[0][0]).toContain(
      '"Naoero" OR "Nauru"',
    );
  });

  it("throws a SearchError with status + real message when the action fails", async () => {
    getSearchResultsMock.mockResolvedValue({
      ok: false,
      status: 400,
      message: "Wildcards (* or ?) require the exact (no-stem) field.",
    });
    await expect(
      getSearchResultsWithFilters({ query: "machine learning", filters }),
    ).rejects.toMatchObject({
      name: "SearchError",
      status: 400,
      message: "Wildcards (* or ?) require the exact (no-stem) field.",
    });
  });
});
