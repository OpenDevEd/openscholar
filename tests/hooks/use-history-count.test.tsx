/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const { searchCountMock } = vi.hoisted(() => ({
  searchCountMock: vi.fn(),
}));

vi.mock("@/app/actions/openalex-count", () => ({
  searchOpenAlexCount: searchCountMock,
}));

import { useHistoryCount } from "@/lib/hooks/use-history-count";
import type { SearchResult } from "@/lib/types";

function makeEntry(
  id: string,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    id,
    query: "cancer therapy",
    queryHistory: [],
    questionHistory: [],
    queryHistoryCount: 0,
    questionCount: 0,
    questionText: "",
    screeningQuestions: [],
    screeningResponses: {},
    count: 0,
    field: "title_and_abstract",
    yearRange: [2020, 2024],
    filterType: "year",
    isYearRangeEnabled: true,
    sortBy: "relevance_score:desc",
    selectedRegions: [],
    selectedCountryFocus: [],
    reviewFilter: false,
    citesItemId: "",
    citedByItemId: "",
    relatedToItemId: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function isolatedWrapper(): React.FC<{ children: React.ReactNode }> {
  return function Wrapper({ children }) {
    return (
      <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
    );
  };
}

beforeEach(() => {
  searchCountMock.mockReset();
});

describe("useHistoryCount", () => {
  it("does nothing and returns undefined count when entry is null", async () => {
    searchCountMock.mockResolvedValue({ count: 99 });
    const { result } = renderHook(() => useHistoryCount(null), {
      wrapper: isolatedWrapper(),
    });
    expect(result.current.count).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(searchCountMock).not.toHaveBeenCalled();
  });

  it("populates count after the server action resolves", async () => {
    searchCountMock.mockResolvedValueOnce({ count: 4217 });
    const entry = makeEntry("e1");
    const { result } = renderHook(() => useHistoryCount(entry), {
      wrapper: isolatedWrapper(),
    });
    expect(result.current.count).toBeUndefined();
    await waitFor(() => expect(result.current.count).toBe(4217));
    expect(result.current.error).toBeUndefined();
  });

  it("exposes the error when the server action rejects", async () => {
    searchCountMock.mockRejectedValueOnce(new Error("network down"));
    const entry = makeEntry("e1");
    const { result } = renderHook(() => useHistoryCount(entry), {
      wrapper: isolatedWrapper(),
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.count).toBeUndefined();
  });

  it("shares one network call when two entries produce the same filter hash", async () => {
    searchCountMock.mockResolvedValue({ count: 77 });
    const a = makeEntry("sr_a");
    const b = makeEntry("sr_b"); // same filters, different id
    const { result } = renderHook(
      () => ({
        a: useHistoryCount(a),
        b: useHistoryCount(b),
      }),
      { wrapper: isolatedWrapper() },
    );
    await waitFor(() => expect(result.current.a.count).toBe(77));
    await waitFor(() => expect(result.current.b.count).toBe(77));
    expect(searchCountMock).toHaveBeenCalledTimes(1);
  });

  it("fires two network calls for two entries with different filter hashes", async () => {
    searchCountMock.mockImplementation((q: string) =>
      Promise.resolve({ count: q === "alpha" ? 1 : 2 }),
    );
    const a = makeEntry("sr_a", { query: "alpha" });
    const b = makeEntry("sr_b", { query: "beta" });
    const { result } = renderHook(
      () => ({
        a: useHistoryCount(a),
        b: useHistoryCount(b),
      }),
      { wrapper: isolatedWrapper() },
    );
    await waitFor(() => expect(result.current.a.count).toBe(1));
    await waitFor(() => expect(result.current.b.count).toBe(2));
    expect(searchCountMock).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on rerender with the same entry reference", async () => {
    searchCountMock.mockResolvedValueOnce({ count: 42 });
    const entry = makeEntry("e1");
    const { result, rerender } = renderHook(
      ({ e }: { e: SearchResult }) => useHistoryCount(e),
      {
        wrapper: isolatedWrapper(),
        initialProps: { e: entry },
      },
    );
    await waitFor(() => expect(result.current.count).toBe(42));
    rerender({ e: entry });
    rerender({ e: entry });
    expect(searchCountMock).toHaveBeenCalledTimes(1);
  });

  it("refresh() invalidates the cache and refetches", async () => {
    searchCountMock
      .mockResolvedValueOnce({ count: 10 })
      .mockResolvedValueOnce({ count: 20 });
    const entry = makeEntry("e1");
    const { result } = renderHook(() => useHistoryCount(entry), {
      wrapper: isolatedWrapper(),
    });
    await waitFor(() => expect(result.current.count).toBe(10));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.count).toBe(20));
    expect(searchCountMock).toHaveBeenCalledTimes(2);
  });
});
