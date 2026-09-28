import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { SearchProvider, useSearch } from "@/lib/search";
import { useQueryHistory } from "@/lib/hooks";
import { useSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";

// A fresh id per test, because the history arrows remember their position per search.
let searchId = "";
vi.mock("next/navigation", () => ({
  useParams: () => ({ searchId }),
  usePathname: () => `/results/${searchId}`,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ search: { failed: vi.fn() } }) }));
vi.mock("@/lib/search-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search-utils")>()),
  getSearchResultsWithFilters: vi.fn(async () => ({
    originalQuery: "",
    enhancedQuery: "",
    countryNames: [],
    validation: { isValid: true, expandedQuery: "", warnings: [] },
    results: { results: [], meta: { count: 0 } },
  })),
}));

const OQL = 'title has (chatgpt) and title has (education or student)';
// The full suite runs many workers at once, so URL updates can take longer than waitFor's default second.
const SETTLE = { timeout: 5000 };

type Entry = { query: string; field: "oql" | "title_and_abstract" };

function seed(history: Entry[]) {
  searchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const current = history.at(-1)!;
  useSearchHistoryStore.setState({
    searchHistory: [
      {
        id: searchId,
        query: current.query,
        field: current.field,
        queryHistory: history.map((entry) => ({ ...entry, timestamp: now })),
        questionHistory: [],
        screeningQuestions: [],
        screeningResponses: {},
        count: 0,
        createdAt: now,
        updatedAt: now,
      } as SearchResult,
    ],
  });
}

function renderSearch(searchParams: string, onUrlUpdate: (event: UrlUpdateEvent) => void) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
      <SearchProvider>{children}</SearchProvider>
    </NuqsTestingAdapter>
  );
  return renderHook(() => {
    const search = useSearch();
    return { search, history: useQueryHistory(searchId, search.setQuery) };
  }, { wrapper });
}

// One step per test: nuqs's testing adapter can drop a second update that arrives
// before it has synced the first, which a person clicking never does.
describe("query history arrows across keyword and OQL scopes", () => {
  it("brings an OQL entry's scope back without putting the query in the URL", async () => {
    seed([{ query: OQL, field: "oql" }, { query: "chatgpt", field: "title_and_abstract" }]);
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderSearch("?q=chatgpt", onUrlUpdate);

    act(() => result.current.history.goToPrevious());

    await waitFor(() => expect(result.current.search.params.field).toBe("oql"), SETTLE);
    const url = onUrlUpdate.mock.calls.at(-1)![0].searchParams;
    expect(url.get("field")).toBe("oql");
    expect(url.has("q")).toBe(false);
    expect(result.current.search.params.q).toBe(OQL);
  });

  it("brings the keyword scope and query back when stepping off an OQL entry", async () => {
    seed([{ query: "tutor", field: "title_and_abstract" }, { query: OQL, field: "oql" }]);
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderSearch("?field=oql", onUrlUpdate);
    expect(result.current.search.params.q).toBe(OQL);

    act(() => result.current.history.goToPrevious());

    await waitFor(() => expect(result.current.search.params.field).toBe("title_and_abstract"), SETTLE);
    expect(onUrlUpdate.mock.calls.at(-1)![0].searchParams.get("q")).toBe("tutor");
    expect(useSearchHistoryStore.getState().searchHistory[0].query).toBe("tutor");
  });
});
