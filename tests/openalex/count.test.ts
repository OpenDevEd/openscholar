import { describe, it, expect, vi, afterEach } from "vitest";

// A count never goes through the SDK, which keeps one key for every host; were it to, this
// keeps the test off the network.
vi.mock("@/lib/openalex", () => ({
  default: { works: () => Promise.reject(new Error("the SDK was asked")) },
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
    minCitations: null,
    hasAbstract: false,
    includeRetracted: false,
    ...overrides,
  };
}

/** Answers every request with `body` and `status`, and keeps the URLs asked. */
function answering(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: URL | string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function askedUrl(fetchMock: ReturnType<typeof answering>) {
  return new URL(String(fetchMock.mock.calls[0]![0]));
}

describe("fetchOpenAlexCount", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns { count } from the response's meta", async () => {
    answering(200, {
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

  it("asks for one work (not the search page's 200)", async () => {
    const fetchMock = answering(200, { meta: { count: 0 }, results: [] });

    await fetchOpenAlexCount("x", filters());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(askedUrl(fetchMock).searchParams.get("per_page")).toBe("1");
  });

  it("passes the filter shape through (spot check: yearRange → from/to_publication_date)", async () => {
    const fetchMock = answering(200, { meta: { count: 5 }, results: [] });

    await fetchOpenAlexCount(
      "neural networks",
      filters({ yearRange: [2020, 2024] }),
    );

    const filter = askedUrl(fetchMock).searchParams.get("filter");
    expect(filter).toContain("from_publication_date:2020-01-01");
    expect(filter).toContain("to_publication_date:2024-12-31");
  });

  it("wraps a refusal with an 'OpenAlex API error' prefix and the API's reason", async () => {
    answering(400, { message: "boom" });
    await expect(fetchOpenAlexCount("x", filters())).rejects.toThrow(
      /OpenAlex API error.*boom/,
    );
  });

  it("wraps an unreachable API with an 'OpenAlex API error' prefix", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
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
