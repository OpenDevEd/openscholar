import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchCountMock } = vi.hoisted(() => ({
  fetchCountMock: vi.fn(),
}));

// Request limits are tested in tests/openalex-request-limit.test.ts.
vi.mock("@/lib/openalex/spend-requests", () => ({ spendOpenAlexRequests: async () => {}, OpenAlexRequestLimitError: class extends Error {} }));
vi.mock("@/lib/openalex/count", () => ({
  fetchOpenAlexCount: fetchCountMock,
  toSearchFilters: vi.fn(),
}));

import { searchOpenAlexCount } from "@/app/actions/openalex-count";
import type { SearchFilters } from "@/lib/types";

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

beforeEach(() => {
  fetchCountMock.mockReset();
});

describe("searchOpenAlexCount (server action)", () => {
  it("delegates to fetchOpenAlexCount with the same (query, filters) pair", async () => {
    fetchCountMock.mockResolvedValueOnce({ count: 777 });
    const f = filters({ yearRange: [2020, 2024] });
    const out = await searchOpenAlexCount("brains", f);
    expect(out).toEqual({ count: 777 });
    expect(fetchCountMock).toHaveBeenCalledTimes(1);
    expect(fetchCountMock).toHaveBeenCalledWith("brains", f);
  });

  it("passes the resolved count through without mutation", async () => {
    fetchCountMock.mockResolvedValueOnce({ count: 0 });
    const out = await searchOpenAlexCount("empty", filters());
    expect(out).toEqual({ count: 0 });
  });

  it("re-throws the underlying error from fetchOpenAlexCount untouched", async () => {
    fetchCountMock.mockRejectedValueOnce(
      new Error("OpenAlex API error: boom"),
    );
    await expect(searchOpenAlexCount("x", filters())).rejects.toThrow(
      /OpenAlex API error: boom/,
    );
  });
});
