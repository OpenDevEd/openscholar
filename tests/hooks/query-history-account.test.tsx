// An account's query history is read from the server a page at a time (#354); every arrow
// press still moves one query, even to a query the page hasn't read yet.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQueryHistory } from "@/lib/hooks";
import { localSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";

// The server's rows, newest first, as `research/records:searchHistory` pages them.
const rows = Array.from({ length: 150 }, (_, i) => ({ text: `query ${149 - i}`, timestamp: "2026-09-01T00:00:00.000Z" }));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "alice" }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  // The page has read only the newest 25 and doesn't grow during the test.
  usePaginatedQuery: () => ({ results: rows.slice(0, 25), status: "CanLoadMore", loadMore: vi.fn() }),
  useConvex: () => ({
    query: async (_: unknown, { paginationOpts }: { paginationOpts: { cursor: string | null; numItems: number } }) => {
      const start = Number(paginationOpts.cursor ?? 0);
      const end = start + paginationOpts.numItems;
      return { page: rows.slice(start, end), isDone: end >= rows.length, continueCursor: String(end) };
    },
  }),
}));

describe("query history arrows on an account's search", () => {
  it("moves on every press, past the queries the page has read", async () => {
    const searchId = crypto.randomUUID();
    localSearchHistoryStore.setState({
      searchHistory: [{ id: searchId, query: "query 149", field: "title_and_abstract", queryHistoryCount: rows.length, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: {}, count: 0, createdAt: "", updatedAt: "" } as SearchResult],
    });
    const setQuery = vi.fn();
    const { result } = renderHook(() => useQueryHistory(searchId, setQuery));
    for (let press = 1; press <= 120; press++) {
      act(() => result.current.goToPrevious());
      await waitFor(() => expect(result.current.historyIndex).toBe(149 - press));
    }
    expect(setQuery).toHaveBeenLastCalledWith("query 29", expect.objectContaining({ skipHistory: true }));
    act(() => result.current.goToNext());
    await waitFor(() => expect(result.current.historyIndex).toBe(30));
    expect(setQuery).toHaveBeenLastCalledWith("query 30", expect.objectContaining({ skipHistory: true }));
  });
});
