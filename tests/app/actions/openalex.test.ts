import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/openalex", () => ({ default: { works: vi.fn() } }));

import client from "@/lib/openalex";
import { getSearchResults, readSearchPage } from "@/app/actions/openalex";
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

describe("readSearchPage", () => {
  const page = { meta: { count: 1, next_cursor: "next-page" }, results: [{ id: "https://openalex.org/W1", abstract_inverted_index: { AI: [0], tutors: [1] } }] };
  let requests: { url: URL; init?: RequestInit }[] = [];
  beforeEach(() => {
    requests = [];
    vi.stubEnv("OPENALEX_API_KEY", "platform-key");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: new URL(String(input)), init });
      return Response.json(page);
    }));
  });
  afterEach(() => vi.unstubAllEnvs());

  // Screen All reads through here, so every page carries OpenScholar's key.
  it("reads a keyword search page at the cursor with OpenScholar's key", async () => {
    const res = await readSearchPage("tutor", filters, "*");
    expect(res).toEqual({ ok: true, works: [expect.objectContaining({ id: "https://openalex.org/W1", abstract: "AI tutors" })], nextCursor: "next-page" });
    const { url } = requests[0]!;
    expect(url.searchParams.get("cursor")).toBe("*");
    expect(url.searchParams.get("per-page")).toBe("200");
    expect(url.searchParams.get("api_key")).toBe("platform-key");
  });

  // The SDK's URL builder pastes search text in as it is; "#" would end the query and drop the key.
  it("sends search text with URL characters intact, and the key with it", async () => {
    await readSearchPage("C# & R+D", filters, "*");
    const { url } = requests[0]!;
    expect(url.searchParams.get("filter")).toContain("title_and_abstract.search:C# & R+D");
    expect(url.searchParams.get("api_key")).toBe("platform-key");
  });

  it("posts an OQL search page at the cursor with OpenScholar's key", async () => {
    const res = await readSearchPage("title has (tutor)", { ...filters, searchField: "oql" }, "next-page");
    expect(res).toMatchObject({ ok: true, nextCursor: "next-page" });
    const { url, init } = requests[0]!;
    expect(init?.method).toBe("POST");
    expect(url.searchParams.get("cursor")).toBe("next-page");
    expect(url.searchParams.get("api_key")).toBe("platform-key");
    expect(JSON.parse(String(init?.body)).oql).toContain("works where (title has (tutor))");
  });
});
