import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { LibraryPageClient } from "@/components/library/library-page-client";

type LibraryQueryState = {
  q: string;
  p: number;
  sort: string;
  view: string;
  rmin: number | null;
  rmax: number | null;
  sf: string | null;
  st: string | null;
  yf: number | null;
  yt: number | null;
  col: string | null;
};

vi.mock("@/convex/_generated/api", () => ({
  api: {
    library: {
      collections: {
        getCollectionsWithCounts: "library:getCollectionsWithCounts",
      },
      queries: {
        getLibraryCount: "library:getLibraryCount",
        getLibraryFilteredCount: "library:getLibraryFilteredCount",
        browseLibrary: "library:browseLibrary",
        searchLibrary: "library:searchLibrary",
        listLibrary: "library:listLibrary",
      },
      mutations: {
        removeFromLibrary: "library:removeFromLibrary",
      },
    },
  },
}));

const {
  browseLoadMoreMock,
  searchLoadMoreMock,
  protectedQueryMock,
  protectedPaginatedQueryMock,
  convexQueryMock,
  exportCsvMock,
  exportJsonMock,
  removeItemMock,
  queryStateStore,
  setQueryStateSpy,
} = vi.hoisted(() => ({
  browseLoadMoreMock: vi.fn(),
  searchLoadMoreMock: vi.fn(),
  protectedQueryMock: vi.fn(),
  protectedPaginatedQueryMock: vi.fn(),
  convexQueryMock: vi.fn(),
  exportCsvMock: vi.fn(),
  exportJsonMock: vi.fn(),
  removeItemMock: vi.fn(),
  queryStateStore: {
    value: {
      q: "",
      p: 1,
      sort: "savedAt:desc",
      view: "list-detail",
      rmin: null,
      rmax: null,
      sf: null,
      st: null,
      yf: null,
      yt: null,
      col: null,
    } as LibraryQueryState,
  },
  setQueryStateSpy: vi.fn(),
}));

vi.mock("nuqs", async () => {
  const React = await import("react");
  const parser = {
    withDefault: <T,>(value: T) => ({ defaultValue: value }),
  };
  return {
    parseAsString: parser,
    parseAsInteger: parser,
    parseAsStringLiteral: () => parser,
    useQueryStates: () => {
      const [state, setState] = React.useState(queryStateStore.value);
      const updateState = (
        next:
          | Partial<typeof queryStateStore.value>
          | ((prev: typeof queryStateStore.value) => Partial<typeof queryStateStore.value>),
        options?: { scroll?: boolean },
      ) => {
        const patch = typeof next === "function" ? next(queryStateStore.value) : next;
        queryStateStore.value = { ...queryStateStore.value, ...patch };
        setState(queryStateStore.value);
        setQueryStateSpy(patch, options);
      };
      return [state, updateState] as const;
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === "showingRange" && values) {
      return `Showing ${values.start}-${values.end} of ${values.total} papers`;
    }
    if (key === "previousPage") return "Previous page";
    if (key === "nextPage") return "Next page";
    if (!values) return key;
    return Object.entries(values).reduce(
      (message, [name, value]) => message.replace(`{${name}}`, String(value)),
      key,
    );
  },
  useFormatter: () => ({
    dateTime: () => "date",
    number: (value: number) => String(value),
  }),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: convexQueryMock }),
  useMutation: () => removeItemMock,
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: protectedQueryMock,
  useProtectedPaginatedQuery: protectedPaginatedQueryMock,
}));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: (value: string) => value,
}));

vi.mock("@/lib/hooks", () => ({
  useIsTablet: () => false,
}));

vi.mock("@/lib/confirmation", () => ({
  showConfirmation: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  useRatingsStore: () => ({ setRating: vi.fn() }),
  useUIStore: Object.assign(
    () => ({ isFocusModeOpen: false }),
    {
      getState: () => ({
        setIsFocusModeOpen: vi.fn(),
      }),
    },
  ),
}));

vi.mock("@/lib/library/export", () => ({
  exportLibraryAsCSV: exportCsvMock,
  exportLibraryAsJSON: exportJsonMock,
}));

vi.mock("@/lib/library/library-item-to-paper-result", () => ({
  libraryItemToPaperResult: (item: {
    openalexId: string;
    title: string;
  }) => ({
    id: item.openalexId,
    title: item.title,
  }),
}));

vi.mock("@/lib/library/download-handlers", () => ({
  downloadLibraryItem: vi.fn(),
  downloadLibraryEssentialItem: vi.fn(),
}));

vi.mock("@/components/results-contexts", () => ({
  TranslationContext: {
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  ScreeningContext: {
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  ServerRatingsContext: {
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@/components/paper-card", () => ({
  PaperCard: ({ result }: { result: { title: string } }) => (
    <div data-testid="paper-card">{result.title}</div>
  ),
}));

vi.mock("@/components/ui/focus-mode", () => ({
  FocusMode: () => null,
}));

vi.mock("@/components/shared/sidebar-layout", () => ({
  SidebarLayout: ({
    children,
    sidebar,
  }: {
    children: ReactNode;
    sidebar: ReactNode;
  }) => (
    <div>
      <div data-testid="library-sidebar">{sidebar}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/PageWrapper", () => ({
  PageWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/command-center/command-center-container", () => ({
  CommandCenterContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/library/collection-manager", () => ({
  CollectionManager: () => null,
}));

vi.mock("@/components/library/collection-picker", () => ({
  CollectionPicker: () => null,
}));

vi.mock("@/components/library/library-command-center", () => ({
  LibraryCommandCenter: ({
    totalCount,
    filteredCount,
    onExportCSV,
    onExportJSON,
    hasExportableResults,
  }: {
    totalCount?: number;
    filteredCount?: number;
    onExportCSV: () => void;
    onExportJSON: () => void;
    hasExportableResults: boolean;
  }) => (
    <div
      data-testid="library-command-center"
      data-total-count={String(totalCount)}
      data-filtered-count={String(filteredCount)}
      data-exportable={String(hasExportableResults)}
    >
      <button type="button" onClick={() => void onExportCSV()}>
        export csv
      </button>
      <button type="button" onClick={() => void onExportJSON()}>
        export json
      </button>
    </div>
  ),
}));

vi.mock("@/components/library/library-empty-state", () => ({
  LibraryEmptyState: ({ variant }: { variant: string }) => (
    <div data-testid="library-empty-state">{variant}</div>
  ),
}));

vi.mock("@/components/library/library-filter-sidebar", () => ({
  LibraryFilterSidebar: () => <div data-testid="library-filter-sidebar" />,
}));

vi.mock("@/components/library/library-item-shared", () => ({
  LibraryItemActions: () => null,
}));

vi.mock("@/components/library/library-item-skeleton", () => ({
  LibraryItemSkeleton: () => <div data-testid="library-item-skeleton" />,
}));

function buildItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `library_${index}`,
    _creationTime: index,
    openalexId: `oa:${index}`,
    title: `Paper ${index + 1}`,
    rating: 3,
    savedAt: 1000 + index,
  }));
}

function readyQueryResult<T>(data: T) {
  return {
    data,
    phase: "authenticated" as const,
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready" as const,
  };
}

function configureProtectedQueryMocks() {
  protectedQueryMock.mockImplementation((queryRef: unknown) => {
    if (queryRef === api.library.collections.getCollectionsWithCounts) {
      return readyQueryResult([]);
    }
    if (queryRef === api.library.queries.getLibraryCount) {
      return readyQueryResult(42);
    }
    if (queryRef === api.library.queries.getLibraryFilteredCount) {
      return readyQueryResult(20);
    }
    throw new Error(`Unexpected protected query: ${String(queryRef)}`);
  });
}

function configurePaginatedMocks({
  browseResults = buildItems(20),
  browseStatus = "CanLoadMore",
  searchResults = buildItems(0),
  searchStatus = "Deferred",
}: {
  browseResults?: ReturnType<typeof buildItems>;
  browseStatus?: "CanLoadMore" | "LoadingMore" | "Exhausted" | "Deferred" | "LoadingFirstPage";
  searchResults?: ReturnType<typeof buildItems>;
  searchStatus?: "CanLoadMore" | "LoadingMore" | "Exhausted" | "Deferred" | "LoadingFirstPage";
} = {}) {
  protectedPaginatedQueryMock.mockImplementation((queryRef: unknown) => {
    if (queryRef === api.library.queries.browseLibrary) {
      return {
        results: browseResults,
        status: browseStatus,
        loadMore: browseLoadMoreMock,
        isLoading: false,
        isInitialLoading: false,
        hasLoadedFirstPage: true,
        isSettled: true,
        phase: "authenticated" as const,
        isDeferred: false,
        isReady: true,
        isAnonymous: false,
        settlement: "ready" as const,
      };
    }
    if (queryRef === api.library.queries.searchLibrary) {
      return {
        results: searchResults,
        status: searchStatus,
        loadMore: searchLoadMoreMock,
        isLoading: false,
        isInitialLoading: false,
        hasLoadedFirstPage: true,
        isSettled: true,
        phase: "authenticated" as const,
        isDeferred: false,
        isReady: true,
        isAnonymous: false,
        settlement: "ready" as const,
      };
    }
    throw new Error(`Unexpected paginated query: ${String(queryRef)}`);
  });
}

describe("LibraryPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryStateStore.value = {
      q: "",
      p: 1,
      sort: "savedAt:desc",
      view: "list-detail",
      rmin: null,
      rmax: null,
      sf: null,
      st: null,
      yf: null,
      yt: null,
      col: null,
    };
    configureProtectedQueryMocks();
    configurePaginatedMocks();
    convexQueryMock.mockResolvedValue(buildItems(25));
  });

  it("mounts browseLibrary through the protected paginated wrapper instead of listLibrary", () => {
    render(<LibraryPageClient />);

    expect(protectedQueryMock).toHaveBeenCalledTimes(3);
    expect(protectedPaginatedQueryMock).toHaveBeenCalledTimes(2);
    const browseCall = protectedPaginatedQueryMock.mock.calls.find(
      ([queryRef]) => queryRef === api.library.queries.browseLibrary,
    );
    expect(browseCall?.[1]).toEqual(
      expect.objectContaining({
        sortBy: "savedAt",
        sortOrder: "desc",
      }),
    );
    expect(browseCall?.[2]).toEqual({
      initialNumItems: 20,
    });
    const searchCall = protectedPaginatedQueryMock.mock.calls.find(
      ([queryRef]) => queryRef === api.library.queries.searchLibrary,
    );
    expect(searchCall?.[1]).toBe("skip");
  });

  it("loads the next paginated page when the user advances past loaded results", async () => {
    render(<LibraryPageClient />);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(browseLoadMoreMock).toHaveBeenCalledWith(20);
    });
    expect(setQueryStateSpy).toHaveBeenCalledWith(
      { p: 2 },
      { scroll: true },
    );
  });

  it("routes active search through searchLibrary with sort args", () => {
    queryStateStore.value.q = "machine";
    configurePaginatedMocks({
      browseResults: buildItems(0),
      browseStatus: "Deferred",
      searchResults: buildItems(2),
      searchStatus: "Exhausted",
    });

    render(<LibraryPageClient />);

    const browseCall = protectedPaginatedQueryMock.mock.calls.find(
      ([queryRef]) => queryRef === api.library.queries.browseLibrary,
    );
    expect(browseCall?.[1]).toBe("skip");
    const searchCall = protectedPaginatedQueryMock.mock.calls.find(
      ([queryRef]) => queryRef === api.library.queries.searchLibrary,
    );
    expect(searchCall?.[1]).toEqual(
      expect.objectContaining({
        searchText: "machine",
        sortBy: "savedAt",
        sortOrder: "desc",
      }),
    );
    expect(searchCall?.[2]).toEqual({
      initialNumItems: 20,
    });
  });

  it("exports through an explicit point-in-time listLibrary query", async () => {
    render(<LibraryPageClient />);

    expect(convexQueryMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "export csv" }));

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(convexQueryMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        sortBy: "savedAt",
        sortOrder: "desc",
        searchText: undefined,
      }),
    );
    expect(exportCsvMock).toHaveBeenCalledWith(buildItems(25));
  });

  it("uses the exact filtered count for command-center totals", () => {
    queryStateStore.value.col = "collection_1";

    render(<LibraryPageClient />);

    expect(screen.getByTestId("library-command-center")).toHaveAttribute(
      "data-total-count",
      "42",
    );
    expect(screen.getByTestId("library-command-center")).toHaveAttribute(
      "data-filtered-count",
      "20",
    );
  });

  it("renders the exact filtered range copy for collection-scoped results", () => {
    queryStateStore.value.col = "collection_1";
    protectedQueryMock.mockImplementation((queryRef: unknown) => {
      if (queryRef === api.library.collections.getCollectionsWithCounts) {
        return readyQueryResult([
          { _id: "collection_1", name: "Focus set", itemCount: 84 },
        ]);
      }
      if (queryRef === api.library.queries.getLibraryCount) {
        return readyQueryResult(86);
      }
      if (queryRef === api.library.queries.getLibraryFilteredCount) {
        return readyQueryResult(84);
      }
      throw new Error(`Unexpected protected query: ${String(queryRef)}`);
    });

    render(<LibraryPageClient />);

    expect(
      screen.getByText("Showing 1-20 of 84 papers"),
    ).toBeInTheDocument();
  });
});
