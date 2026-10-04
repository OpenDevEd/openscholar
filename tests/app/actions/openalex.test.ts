import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Request limits are tested in tests/openalex-request-limit.test.ts.
vi.mock("@/lib/openalex/spend-requests", () => ({ spendOpenAlexRequests: async () => {}, OpenAlexRequestLimitError: class extends Error {} }));
vi.mock("@/lib/openalex", () => ({ default: { works: vi.fn() } }));

import client from "@/lib/openalex";
import { getSearchResults } from "@/app/actions/openalex";
import type { SearchFilters } from "@/lib/types";

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

const works = client.works as unknown as ReturnType<typeof vi.fn>;

describe("getSearchResults", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:true with the SDK data on success", async () => {
    works.mockResolvedValue({ results: [], meta: { count: 5 } });
    const res = await getSearchResults("machine learning", filters);
    expect(res).toEqual({ ok: true, data: { results: [], meta: { count: 5 } } });
  });

  it("returns a structured error carrying OpenAlex's real reason when the SDK throws", async () => {
    works.mockRejectedValue(new Error("Error 400: undefined"));
    const fetchMock = vi.fn().mockResolvedValue({
      status: 400,
      json: async () => ({
        error: "Invalid query parameters error.",
        message: "Wildcards (* or ?) require the exact (no-stem) field.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getSearchResults("transform*", filters);

    expect(res).toEqual({
      ok: false,
      status: 400,
      message: "Wildcards (* or ?) require the exact (no-stem) field.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
