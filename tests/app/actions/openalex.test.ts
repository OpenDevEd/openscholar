import { describe, it, expect, vi, afterEach } from "vitest";

// Request limits are tested in tests/openalex-request-limit.test.ts.
vi.mock("@/lib/openalex/spend-requests", () => ({ spendOpenAlexRequests: async () => {}, OpenAlexRequestLimitError: class extends Error {} }));
// A search never goes through the SDK, which keeps one key for every host; were it to, this
// keeps the test off the network.
vi.mock("@/lib/openalex", () => ({ default: { works: () => Promise.reject(new Error("the SDK was asked")) } }));

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
  minCitations: null,
  hasAbstract: false,
  includeRetracted: false,
};

/** Answers every request with `body` and `status`, and keeps the URLs asked. */
function answering(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: URL | string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getSearchResults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for the first page of works, and answers it with each abstract as text", async () => {
    const work = { id: "https://openalex.org/W1", abstract_inverted_index: { learning: [1], Deep: [0] } };
    const fetchMock = answering(200, { meta: { count: 5 }, results: [work] });
    const res = await getSearchResults("machine learning", filters);
    expect(res).toEqual({ ok: true, data: { meta: { count: 5 }, results: [{ id: "https://openalex.org/W1", abstract: "Deep learning" }] } });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/works");
    expect(url.searchParams.get("filter")).toContain("title_and_abstract.search:machine learning");
    expect([url.searchParams.get("per_page"), url.searchParams.get("cursor")]).toEqual(["200", "*"]);
  });

  it("returns the API's own reason for a refused search, asking once", async () => {
    const fetchMock = answering(400, {
      error: "Invalid query parameters error.",
      message: "Wildcards (* or ?) require the exact (no-stem) field.",
    });

    const res = await getSearchResults("transform*", filters);

    expect(res).toEqual({
      ok: false,
      status: 400,
      message: "Wildcards (* or ?) require the exact (no-stem) field.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says the search failed when the API cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await getSearchResults("x", filters)).toEqual({ ok: false, status: null, message: "Search request failed" });
  });
});
