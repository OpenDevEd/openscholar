/**
 * @vitest-environment jsdom
 *
 * Integration test for the history-selector ↔ CountChip ↔ bucket store
 * wiring added in P7 T8. Uses the real bucket store; mocks Convex, the
 * search-history store, the fresh-count SWR hook, and next-intl.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { historyEntriesRef, bucketAddedMock, useHistoryCountMock } = vi.hoisted(
  () => ({
    historyEntriesRef: { current: [] as unknown[] },
    bucketAddedMock: vi.fn(),
    useHistoryCountMock: vi.fn((_entry?: unknown) => ({
      count: undefined,
      isLoading: false,
      error: undefined,
      refresh: vi.fn(),
    })),
  }),
);

vi.mock("next-intl", () => ({
  useTranslations: () =>
    (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  useFormatter: () => ({
    number: (n: number) => String(n),
    relativeTime: () => "recently",
  }),
  useNow: () => new Date(0),
}));

vi.mock("lucide-react", () => ({
  Search: () => null,
  Calendar: () => null,
  FileText: () => null,
  ChevronDown: () => null,
  Minus: () => null,
  Plus: () => null,
  Loader2: () => null,
  CheckIcon: () => null,
  Check: () => null,
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined, // lets the `?? fallback` defaults kick in
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
    },
  },
}));

vi.mock("@/lib/store", () => ({
  useSearchHistoryStore: <T,>(selector: (s: unknown) => T) =>
    selector({ searchHistory: historyEntriesRef.current }),
  useKeywordExpansionStore: {
    getState: () => ({ expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }),
  },
}));

vi.mock("@/lib/toast/bucket", () => ({
  bucketAdded: bucketAddedMock,
}));

vi.mock("@/lib/hooks/use-history-count", () => ({
  useHistoryCount: (entry: unknown) => useHistoryCountMock(entry),
}));

vi.mock("@/components/ui/popover", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Popover: Passthrough,
    PopoverTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) =>
      asChild ? (
        <>{children}</>
      ) : (
        <div data-testid="popover-trigger">{children}</div>
      ),
    PopoverContent: Passthrough,
    PopoverHeader: Passthrough,
    PopoverTitle: Passthrough,
    PopoverDescription: Passthrough,
  };
});

import { HistorySelector } from "@/components/extraction/history-selector";
import { useBucketStore } from "@/lib/store/bucket";
import { fromSavedSearchQuery } from "@/lib/bucket/bucketItem";
import type { SearchResult } from "@/lib/types";

function makeHistoryEntry(
  id: string,
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    id,
    query: `query-${id}`,
    queryHistory: [],
    questionHistory: [],
    screeningQuestions: [],
    screeningResponses: {},
    count: 500,
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

function stageEntry(entry: SearchResult) {
  act(() => {
    useBucketStore
      .getState()
      .addMany(
        [
          fromSavedSearchQuery({
            id: entry.id,
            query: entry.query,
            count: entry.count,
            searchFilters: { query: "neural networks", openAlexQuery: { sort: "relevance_score:desc" } },
          }),
        ],
        1000,
      );
  });
}

beforeEach(() => {
  useBucketStore.getState().clear();
  window.localStorage.clear();
  historyEntriesRef.current = [];
  bucketAddedMock.mockReset();
  useHistoryCountMock.mockReset();
  useHistoryCountMock.mockReturnValue({
    count: undefined,
    isLoading: false,
    error: undefined,
    refresh: vi.fn(),
  });
});

afterEach(() => {
  useBucketStore.getState().clear();
});

describe("<HistorySelector> ↔ <CountChip> integration", () => {
  it("renders NO CountChip for an unselected history row", () => {
    historyEntriesRef.current = [makeHistoryEntry("sr_1")];
    render(<HistorySelector />);
    expect(screen.queryByRole("button", { name: /chipLabel/ })).toBeNull();
  });

  it("renders a CountChip for a selected row", () => {
    const entry = makeHistoryEntry("sr_1");
    historyEntriesRef.current = [entry];
    stageEntry(entry);
    render(<HistorySelector />);
    const chip = screen.queryByRole("button", { name: /chipLabel/ });
    expect(chip).toBeInTheDocument();
    const label = chip?.getAttribute("aria-label") ?? "";
    expect(label).toContain("query-sr_1");
  });

  it("selection summary reads bucket paperCount, not entry.count", () => {
    const entry = makeHistoryEntry("sr_1", { count: 500 });
    historyEntriesRef.current = [entry];
    stageEntry(entry);
    // Fresh count arrives at 120 → user-driven clamp (simulated here).
    act(() => {
      useBucketStore
        .getState()
        .updatePaperCount("history:sr_1", 120, 200);
    });
    render(<HistorySelector />);
    const header = document.querySelector("[data-selectable-header]");
    const text = header?.textContent ?? "";
    expect(text).toMatch(/120/);
    expect(text).not.toMatch(/500/);
  });

  it("unmounts the CountChip when the row is deselected", () => {
    const entry = makeHistoryEntry("sr_1");
    historyEntriesRef.current = [entry];
    stageEntry(entry);
    render(<HistorySelector />);
    expect(
      screen.queryByRole("button", { name: /chipLabel/ }),
    ).toBeInTheDocument();
    act(() => {
      useBucketStore.getState().removeMany(["history:sr_1"]);
    });
    expect(screen.queryByRole("button", { name: /chipLabel/ })).toBeNull();
  });

  it("clicking the CountChip trigger does NOT bubble up to deselect the row", () => {
    const entry = makeHistoryEntry("sr_1");
    historyEntriesRef.current = [entry];
    stageEntry(entry);
    render(<HistorySelector />);
    expect(useBucketStore.getState().items["history:sr_1"]).toBeDefined();
    const chip = screen.getByRole("button", { name: /chipLabel/ });
    fireEvent.click(chip);
    // Row would call removeMany on a deselect bubble — staged must stay.
    expect(useBucketStore.getState().items["history:sr_1"]).toBeDefined();
  });

  it("pressing Space/Enter on a chip preset does NOT bubble up to the row", () => {
    const entry = makeHistoryEntry("sr_1");
    historyEntriesRef.current = [entry];
    stageEntry(entry);
    render(<HistorySelector />);
    const chip = screen.getByRole("button", { name: /chipLabel/ });
    fireEvent.keyDown(chip, { key: "Enter" });
    fireEvent.keyDown(chip, { key: " " });
    expect(useBucketStore.getState().items["history:sr_1"]).toBeDefined();
  });

  it("clamps the staged paperCount to the per-row pull cap at selection time", () => {
    const entry = makeHistoryEntry("sr_1", { count: 3000 });
    historyEntriesRef.current = [entry];
    render(<HistorySelector />);
    const row = document.querySelector("[data-selectable-row]");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    const staged = useBucketStore.getState().items["history:sr_1"];
    expect(staged).toBeDefined();
    // Cold-start seed from entry.count=3000 must be clamped to the
    // per-row pull cap (fallback 200) so the ready-count budget is
    // respected even before the fresh-count SWR resolves.
    expect(staged!.paperCount).toBeLessThanOrEqual(200);
  });
});
