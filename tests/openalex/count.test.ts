import { describe, it, expect, vi, beforeEach } from "vitest";

const { worksMock } = vi.hoisted(() => ({ worksMock: vi.fn() }));

vi.mock("@/lib/openalex", () => ({
  default: { works: worksMock },
}));

import { fetchOpenAlexCount } from "@/lib/openalex/count";
import { toSearchFilters } from "@/lib/openalex/to-search-filters";
import type { SearchFilters } from "@/lib/types";
import type { SearchResult } from "@/lib/types";

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  worksMock.mockReset();
});

describe("fetchOpenAlexCount", () => {
  it("returns { count } from SDK response meta", async () => {
    worksMock.mockResolvedValueOnce({
      meta: {
        count: 4217,
        db_response_time_ms: 12,
        page: 1,
        per_page: 1,
        groups_count: null,
        next_cursor: "",
      },
      results: [{ id: "W1" }],
    });
    const result = await fetchOpenAlexCount(
      "cancer",
      filters({ yearRange: [2020, 2024] }),
    );
    expect(result).toEqual({ count: 4217 });
  });

  it("calls client.works with perPage: 1 (not the default 200)", async () => {
    worksMock.mockResolvedValueOnce({
      meta: { count: 0 },
      results: [],
    });
    await fetchOpenAlexCount("x", filters());
    expect(worksMock).toHaveBeenCalledTimes(1);
    const params = worksMock.mock.calls[0][0];
    expect(params.perPage).toBe(1);
  });

  it("passes the filter shape through (spot check: yearRange → from/to_publication_date)", async () => {
    worksMock.mockResolvedValueOnce({
      meta: { count: 5 },
      results: [],
    });
    await fetchOpenAlexCount(
      "neural networks",
      filters({ yearRange: [2020, 2024] }),
    );
    const params = worksMock.mock.calls[0][0];
    expect(params.filter?.from_publication_date).toBe("2020-01-01");
    expect(params.filter?.to_publication_date).toBe("2024-12-31");
  });

  it("wraps SDK errors with an 'OpenAlex API error' prefix", async () => {
    worksMock.mockRejectedValueOnce(new Error("boom"));
    await expect(fetchOpenAlexCount("x", filters())).rejects.toThrow(
      /OpenAlex API error.*boom/,
    );
  });

  it("wraps non-Error throws with an 'OpenAlex API error' prefix", async () => {
    worksMock.mockRejectedValueOnce("network down");
    await expect(fetchOpenAlexCount("x", filters())).rejects.toThrow(
      /OpenAlex API error/,
    );
  });
});

describe("toSearchFilters", () => {
  const entry: SearchResult = {
    id: "sr_1",
    query: "cancer",
    queryHistory: [],
    questionHistory: [],
    queryHistoryCount: 0,
    questionCount: 0,
    questionText: "",
    screeningQuestions: [],
    screeningResponses: {},
    count: 4217,
    field: "title_and_abstract",
    yearRange: [2020, 2024],
    isYearRangeEnabled: true,
    filterType: "year",
    sortBy: "relevance_score:desc",
    selectedRegions: ["US"],
    selectedCountryFocus: [],
    reviewFilter: false,
    researchAreas: [],
    sdgs: [],
    openAccessOnly: false,
    workTypes: [],
    workLanguages: [],
    institutionTypes: [],
    funders: [],
    authors: [],
    hasAbstract: false,
    includeRetracted: false,
    citesItemId: "",
    citedByItemId: "",
    relatedToItemId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("maps entry.field to SearchFilters.searchField", () => {
    const out = toSearchFilters(entry);
    expect(out.searchField).toBe("title_and_abstract");
  });

  it("preserves yearRange, filterType, and regions", () => {
    const out = toSearchFilters(entry);
    expect(out.yearRange).toEqual([2020, 2024]);
    expect(out.filterType).toBe("year");
    expect(out.selectedRegions).toEqual(["US"]);
  });

  it("supplies empty-string defaults for optional ID filters", () => {
    const spare: SearchResult = {
      ...entry,
      citesItemId: undefined,
      citedByItemId: undefined,
      relatedToItemId: undefined,
      reviewFilter: undefined,
      selectedRegions: undefined,
      selectedCountryFocus: undefined,
    };
    const out = toSearchFilters(spare);
    expect(out.citesItemId).toBe("");
    expect(out.citedByItemId).toBe("");
    expect(out.relatedToItemId).toBe("");
    expect(out.reviewFilter).toBe(false);
    expect(out.selectedRegions).toEqual([]);
    expect(out.selectedCountryFocus).toEqual([]);
  });
});
