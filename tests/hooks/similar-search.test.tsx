/**
 * The results page's search for the works nearest given papers: the papers in its address reach the
 * request the provider runs, so the OpenScholar API is asked for them as similar_to.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
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

import { SearchProvider, useSearch } from "@/lib/search";

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
});
