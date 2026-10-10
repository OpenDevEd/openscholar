/**
 * The results page's search for the works nearest given papers: the papers in its address reach the
 * request the provider runs, so the OpenScholar API is asked for them as similar_to.
 */
import React from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

const { searched } = vi.hoisted(() => ({ searched: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ searchId: "similar-search" }),
  usePathname: () => "/results/similar-search",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: null }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ search: { failed: vi.fn() } }) }));
vi.mock("@/lib/search/search-results", () => ({
  getSearchResultsWithFilters: (...args: unknown[]) => {
    searched(...args);
    return Promise.resolve({
      originalQuery: "",
      enhancedQuery: "",
      countryNames: [],
      validation: { isValid: true, expandedQuery: "", warnings: [] },
      results: { results: [], meta: { count: 0 } },
    });
  },
}));

import { SearchProvider, useSearch, type SearchParams } from "@/lib/search";
import { useUpdateSearchFilter } from "@/lib/hooks";
import { createSimilarSearch } from "@/lib/search/actions";
import { DEFAULT_SEARCH_PARAMS } from "@/lib/search-params/parsers";
import { localKeywordExpansionStore, localRatingsStore, localSearchHistoryStore, useSearchHistoryStore } from "@/lib/store";
import { ResearchContext } from "@/lib/research/binding";
import type { SearchResult } from "@/lib/types";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NuqsTestingAdapter searchParams="?like=OS64233829,OS14687712">
    <SearchProvider>{children}</SearchProvider>
  </NuqsTestingAdapter>
);

describe("the results page's search for the works nearest given papers", () => {
  it("asks for the papers in its address, by relevance", async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    expect(result.current.params.like).toEqual(["OS64233829", "OS14687712"]);
    await waitFor(() => expect(searched).toHaveBeenCalled(), { timeout: 5000 });
    const [asked] = searched.mock.calls.at(-1) as [{ filters: { similarTo?: string[]; sortBy?: string } }];
    expect(asked.filters).toMatchObject({ similarTo: ["OS64233829", "OS14687712"], sortBy: "relevance_score:desc" });
  });

  it("drops the papers when the filters are reset", async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.params.like).toEqual([]));
  });

  it("drops the papers when the search turns to a question by meaning, which ranks the works by itself", async () => {
    const { result } = renderHook(() => ({ search: useSearch(), updateFilter: useUpdateSearchFilter() }), { wrapper });
    act(() => result.current.updateFilter({ currentSearchField: "semantic" }));
    await waitFor(() => expect(result.current.search.params.field).toBe("semantic"));
    expect(result.current.search.params.like).toEqual([]);
  });

  it("drops the papers when the search turns to OQL, which the API runs without them", async () => {
    const { result } = renderHook(() => ({ search: useSearch(), updateFilter: useUpdateSearchFilter() }), { wrapper });
    act(() => result.current.updateFilter({ currentSearchField: "oql" }));
    await waitFor(() => expect(result.current.search.params.field).toBe("oql"));
    expect(result.current.search.params.like).toEqual([]);
  });

  it("drops the papers when a step through the query history turns the search to a question by meaning", async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    act(() => result.current.setQuery("kelp forests", { field: "semantic", skipHistory: true }));
    await waitFor(() => expect(result.current.params.field).toBe("semantic"));
    expect(result.current.params.like).toEqual([]);
  });

  it("reads an address that names papers beside a question by meaning as like none, and keeps them gone", async () => {
    const conflicting = ({ children }: { children: React.ReactNode }) => (
      <NuqsTestingAdapter searchParams="?field=semantic&q=seagrass+meadows&like=OS64233829">
        <SearchProvider>{children}</SearchProvider>
      </NuqsTestingAdapter>
    );
    searched.mockClear();
    const { result } = renderHook(() => ({ search: useSearch(), updateFilter: useUpdateSearchFilter() }), { wrapper: conflicting });
    expect(result.current.search.params.like).toEqual([]);
    await waitFor(() => expect(searched).toHaveBeenCalled(), { timeout: 5000 });
    const [asked] = searched.mock.calls.at(-1) as [{ filters: { similarTo?: string[] } }];
    expect(asked.filters.similarTo).toEqual([]);
    act(() => result.current.updateFilter({ currentSearchField: "title" }));
    await waitFor(() => expect(result.current.search.params.field).toBe("title"));
    expect(result.current.search.params.like).toEqual([]);
  });

  it("drops the papers from the saved search too when a search edited in place turns to OQL", () => {
    const { id } = createSimilarSearch(["OS64233829"]);
    const params: SearchParams = { ...DEFAULT_SEARCH_PARAMS, like: ["OS64233829"] };
    const onParamsChange = vi.fn();
    const inPlace = ({ children }: { children: React.ReactNode }) => (
      <NuqsTestingAdapter>
        <SearchProvider local={{ searchId: id, params, onParamsChange }}>{children}</SearchProvider>
      </NuqsTestingAdapter>
    );
    const { result } = renderHook(() => useUpdateSearchFilter(), { wrapper: inPlace });
    act(() => result.current({ currentSearchField: "oql" }));
    expect(onParamsChange).toHaveBeenCalledWith(expect.objectContaining({ field: "oql", like: [] }));
    expect(useSearchHistoryStore.getState().getSearchResult(id)).toMatchObject({ field: "oql", similarTo: [] });
  });

  it("drops papers a saved search gains beside a question by meaning when the scope changes later", async () => {
    const now = new Date().toISOString();
    const saved = {
      id: "similar-search", query: "tidal flats", field: "semantic", queryHistory: [], questionHistory: [], queryHistoryCount: 1,
      questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: {}, count: 0, createdAt: now, updatedAt: now,
    } as SearchResult;
    const before = localSearchHistoryStore.getState().searchHistory;
    localSearchHistoryStore.setState({ searchHistory: [saved] });
    onTestFinished(() => {
      localSearchHistoryStore.setState({ searchHistory: before });
    });
    // Signed in, the page shows the saved search rather than its address.
    const account = { history: localSearchHistoryStore, shortcuts: localKeywordExpansionStore, ratings: localRatingsStore };
    const signedIn = ({ children }: { children: React.ReactNode }) => (
      <NuqsTestingAdapter hasMemory>
        <ResearchContext.Provider value={account}><SearchProvider>{children}</SearchProvider></ResearchContext.Provider>
      </NuqsTestingAdapter>
    );
    const { result } = renderHook(() => ({ search: useSearch(), updateFilter: useUpdateSearchFilter() }), { wrapper: signedIn });
    expect(result.current.search.params).toMatchObject({ field: "semantic", like: [] });
    // Edited elsewhere, as on another device: papers come into the saved search with no change of field.
    act(() => localSearchHistoryStore.getState().updateSearchResult("similar-search", { similarTo: ["OS64233829"] }));
    expect(result.current.search.params.like).toEqual([]);
    act(() => result.current.updateFilter({ currentSearchField: "title" }));
    await waitFor(() => expect(result.current.search.params.field).toBe("title"));
    expect(result.current.search.params.like).toEqual([]);
    expect(localSearchHistoryStore.getState().getSearchResult("similar-search")?.similarTo).toEqual([]);
  });

  it("keeps the papers when the search's words turn to another field, which only filter what they find", async () => {
    const { result } = renderHook(() => ({ search: useSearch(), updateFilter: useUpdateSearchFilter() }), { wrapper });
    act(() => result.current.updateFilter({ currentSearchField: "title" }));
    await waitFor(() => expect(result.current.search.params.field).toBe("title"));
    expect(result.current.search.params.like).toEqual(["OS64233829", "OS14687712"]);
  });
});
