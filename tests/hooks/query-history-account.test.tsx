// An account's query history is read from the server a page at a time (#354); every arrow
// press still moves one query, even to a query the page hasn't read yet.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQueryHistory } from "@/lib/hooks";
import { localSearchHistoryStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";

// The server's rows, newest first, as `research/records:searchHistory` pages them.
const rows = Array.from({ length: 150 }, (_, i) => ({ text: `query ${149 - i}`, timestamp: "2026-09-01T00:00:00.000Z" }));
// The page has read only the newest 25; once asked for more, it stays loading.
let status = "CanLoadMore";
// When set, the server answers only when the test says so.
let held: Array<() => void> | null = null;
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "alice" }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  usePaginatedQuery: () => ({ results: rows.slice(0, 25), status, loadMore: () => { status = "LoadingMore"; } }),
  useConvex: () => ({
    query: async (_: unknown, { paginationOpts }: { paginationOpts: { cursor: string | null; numItems: number } }) => {
      if (held) await new Promise<void>((resolve) => held!.push(resolve));
      const start = Number(paginationOpts.cursor ?? 0);
      const end = start + paginationOpts.numItems;
      return { page: rows.slice(start, end), isDone: end >= rows.length, continueCursor: String(end) };
    },
  }),
}));

let searchId = "";
beforeEach(() => {
  status = "CanLoadMore";
  held = null;
  searchId = crypto.randomUUID();
  localSearchHistoryStore.setState({
    searchHistory: [{ id: searchId, query: "query 149", field: "title_and_abstract", queryHistoryCount: rows.length, questionCount: 0, questionText: "", screeningQuestions: [], screeningResponses: {}, count: 0, createdAt: "", updatedAt: "" } as SearchResult],
  });
});

async function stepBack(result: { current: ReturnType<typeof useQueryHistory> }, presses: number) {
  for (let press = 0; press < presses; press++) {
    const before = result.current.historyIndex;
    act(() => result.current.goToPrevious());
    await waitFor(() => expect(result.current.historyIndex).toBe(before - 1));
  }
}

describe("query history arrows on an account's search", () => {
  it("moves on every press, past the queries the page has read and while it reads more", async () => {
    const setQuery = vi.fn();
    const { result } = renderHook(() => useQueryHistory(searchId, setQuery));
    await stepBack(result, 120);
    expect(status).toBe("LoadingMore");
    expect(setQuery).toHaveBeenLastCalledWith("query 29", expect.objectContaining({ skipHistory: true }));
    act(() => result.current.goToNext());
    await waitFor(() => expect(result.current.historyIndex).toBe(30));
    expect(setQuery).toHaveBeenLastCalledWith("query 30", expect.objectContaining({ skipHistory: true }));
  });

  it("drops a read that ends after the arrows moved elsewhere", async () => {
    const first = vi.fn();
    const mounted = renderHook(() => useQueryHistory(searchId, first));
    await stepBack(mounted.result, 25);
    held = [];
    act(() => mounted.result.current.goToPrevious());
    await waitFor(() => expect(held).toHaveLength(1));
    // The arrows remount, as switching between Search and Adjust does, and step forward.
    mounted.unmount();
    const second = vi.fn();
    const { result } = renderHook(() => useQueryHistory(searchId, second));
    act(() => result.current.goToNext());
    await waitFor(() => expect(result.current.historyIndex).toBe(125));
    await act(async () => { held!.forEach((resolve) => resolve()); held = null; });
    expect(first).toHaveBeenCalledTimes(25);
    expect(result.current.historyIndex).toBe(125);
    expect(second).toHaveBeenLastCalledWith("query 125", expect.objectContaining({ skipHistory: true }));
  });
});
