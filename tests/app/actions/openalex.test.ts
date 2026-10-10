import { describe, it, expect, vi, afterEach } from "vitest";

const { spent } = vi.hoisted(() => ({ spent: vi.fn(async () => {}) }));
// Request limits are tested in tests/openalex-request-limit.test.ts.
vi.mock("@/lib/openalex/spend-requests", () => ({ spendOpenAlexRequests: spent, OpenAlexRequestLimitError: class extends Error {} }));
// A search never goes through the SDK, which keeps one key for every host; were it to, this
// keeps the test off the network.
vi.mock("@/lib/openalex", () => ({ default: { works: () => Promise.reject(new Error("the SDK was asked")) } }));

import { getClosenessOrder, getSearchResults, getSimilarWorks } from "@/app/actions/openalex";
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

describe("getSimilarWorks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks the OpenScholar API for the works nearest a paper, as many as asked, without retracted works", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    const fetchMock = answering(200, { meta: { count: 8, searched_count: 91_058_841 }, results: [{ id: "https://openscholar.ai/OS1" }] });
    const answer = await getSimilarWorks("https://openscholar.ai/OS64233829", 8);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("similar_to")).toBe("https://openscholar.ai/OS64233829");
    expect(url.searchParams.get("per-page") ?? url.searchParams.get("per_page")).toBe("8");
    expect(url.searchParams.get("filter")).toBe("is_retracted:false");
    expect(answer.ok && answer.data.results.map((work) => work.id)).toEqual(["https://openscholar.ai/OS1"]);
  });
});


describe("getClosenessOrder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks the OpenScholar API to order the works shown by the papers rated alike and unlike", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    const fetchMock = answering(200, { meta: { count: 1 }, results: [{ id: "https://openscholar.ai/OS1", relevance_score: 0.2 }] });
    expect(await getClosenessOrder(["OS1"], ["OS7"], ["OS8"])).toEqual({ ok: true, order: [{ id: "https://openscholar.ai/OS1", score: 0.2 }] });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect([url.pathname, url.searchParams.get("works"), url.searchParams.get("similar_to"), url.searchParams.get("dissimilar_to")]).toEqual(["/works/closeness", "OS1", "OS7", "OS8"]);
  });

  it("orders nothing, and spends nothing, without the OpenScholar API", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "");
    spent.mockClear();
    const fetchMock = answering(200, { results: [] });
    expect(await getClosenessOrder(["W1"], ["W2"], [])).toMatchObject({ ok: false, status: null });
    expect([spent.mock.calls.length, fetchMock.mock.calls.length]).toEqual([0, 0]);
  });

  it("refuses, without asking, more than the API takes, or no paper to be like", async () => {
    vi.stubEnv("OPENSCHOLAR_API_URL", "https://search-api.example.org");
    const fetchMock = answering(200, { results: [] });
    const many = Array.from({ length: 201 }, (_, at) => `OS${at + 1}`);
    for (const [works, similarTo] of [[many, ["OS7"]], [["OS1"], []]] as const) {
      expect(await getClosenessOrder([...works], [...similarTo], [])).toMatchObject({ ok: false, status: 400 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
