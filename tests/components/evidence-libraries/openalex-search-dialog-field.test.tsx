/**
 * @vitest-environment jsdom
 *
 * The OpenAlex source dialog's own resets keep the running search's saved field, as the search
 * provider's changes do: an AI rewrite that comes back reads it to tell whether the search changed
 * kind meanwhile (lib/search/scope-now.ts).
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/settings",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: null }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key, useLocale: () => "en" }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ search: { failed: vi.fn() } }) }));
vi.mock("@/lib/search/search-results", () => ({
  getSearchResultsWithFilters: vi.fn(async () => ({
    originalQuery: "",
    enhancedQuery: "",
    countryNames: [],
    validation: { isValid: true, expandedQuery: "", warnings: [] },
    results: { results: [], meta: { count: 0 } },
  })),
}));
vi.mock("@/lib/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks")>()),
  useIsTablet: () => false,
}));
// The results and the sidebar stand in for the person: one picks the field through the search, the other clears every filter.
vi.mock("@/components/results-list", async () => {
  const { useSearch } = await import("@/lib/search");
  return {
    ResultsList: () => {
      const search = useSearch();
      return <button type="button" onClick={() => search.updateParams({ field: "semantic" })}>ask by meaning</button>;
    },
  };
});
vi.mock("@/components/search-sidebar", () => ({
  SidebarContent: ({ onClearAllFilters }: { onClearAllFilters: () => void }) => (
    <button type="button" onClick={onClearAllFilters}>clear every filter</button>
  ),
}));
vi.mock("@/components/history-command-center", () => ({ HistoryCommandCenter: () => null }));

import { OpenAlexSearchDialog } from "@/components/evidence-libraries/configuration/sections/openalex-search-dialog";
import { useSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";

const SEARCH_ID = "openalex-source-search";

function openDialog() {
  const now = new Date().toISOString();
  useSearchHistoryStore.setState({
    searchHistory: [{
      id: SEARCH_ID, query: "", field: "title_and_abstract", queryHistory: [], questionHistory: [], queryHistoryCount: 0,
      questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: {}, count: 0, createdAt: now, updatedAt: now,
    } as SearchResult],
  });
  render(<OpenAlexSearchDialog initial={null} searchId={SEARCH_ID} onClose={vi.fn()} onApprove={vi.fn()} />, {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <NuqsTestingAdapter><TooltipProvider>{children}</TooltipProvider></NuqsTestingAdapter>
    ),
  });
}

const savedField = () => useSearchHistoryStore.getState().getSearchResult(SEARCH_ID)?.field;

describe("the OpenAlex source dialog's own resets", () => {
  it("put the saved field back with the search on Reset", () => {
    openDialog();
    act(() => fireEvent.click(screen.getByRole("button", { name: "ask by meaning" })));
    expect(savedField()).toBe("semantic");
    act(() => fireEvent.click(screen.getByRole("button", { name: "reset" })));
    expect(savedField()).toBe("title_and_abstract");
  });

  it("put the saved field back with the search when every filter is cleared", () => {
    openDialog();
    act(() => fireEvent.click(screen.getByRole("button", { name: "ask by meaning" })));
    expect(savedField()).toBe("semantic");
    act(() => fireEvent.click(screen.getAllByRole("button", { name: "clear every filter" })[0]));
    expect(savedField()).toBe("title_and_abstract");
  });
});
