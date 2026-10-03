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
        getCollection: "library:getCollection",
      },
      queries: {
        getLibraryCount: "library:getLibraryCount",
        getLibraryFilteredCount: "library:getLibraryFilteredCount",
        browseLibrary: "library:browseLibrary",
        searchLibrary: "library:searchLibrary",
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
  queryFixtureStore,
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
  queryFixtureStore: {
    protected: {} as Record<string, unknown>,
    paginated: {} as Record<string, unknown>,
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
  useProtectedStreamPaginatedQuery: protectedPaginatedQueryMock,
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

vi.mock("@/lib/library/export", async (importOriginal) => ({
  readEveryLibraryPage: (await importOriginal<typeof import("@/lib/library/export")>()).readEveryLibraryPage,
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

vi.mock("@/components/library/library-command-center", () => ({
  LibraryCommandCenter: ({
    rawSearch,
    onSearchChange,
    totalCount,
    filteredCount,
    onExportCSV,
    onExportJSON,
    hasExportableResults,
  }: {
    rawSearch: string;
    onSearchChange: (value: string) => void;
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
      <p>
        {filteredCount !== undefined &&
        totalCount !== undefined &&
        filteredCount !== totalCount
          ? `${filteredCount} / ${totalCount} results`
          : `${totalCount ?? 0} results`}
      </p>
      <label htmlFor="library-search-input">Library search</label>
      <input
        id="library-search-input"
        value={rawSearch}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      {rawSearch.length > 0 && (
        <button type="button" onClick={() => onSearchChange("")}>
          Clear search
        </button>
      )}
      {hasExportableResults && (
        <>
          <button type="button" onClick={() => void onExportCSV()}>
            export csv
          </button>
          <button type="button" onClick={() => void onExportJSON()}>
            export json
          </button>
        </>
      )}
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

type PaginatedStatus =
  | "CanLoadMore"
  | "LoadingMore"
  | "Exhausted"
  | "Deferred"
  | "LoadingFirstPage";

type PaginatedFixture = {
  results: ReturnType<typeof buildItems>;
  status: PaginatedStatus;
};

function buildItems(
  count: number,
  options: {
    titlePrefix?: string;
    startIndex?: number;
  } = {},
) {
  const titlePrefix = options.titlePrefix ?? "Paper";
  const startIndex = options.startIndex ?? 0;
  return Array.from({ length: count }, (_, index) => {
    const ordinal = startIndex + index + 1;
    return {
      _id: `library_${titlePrefix.toLowerCase().replace(/\s+/g, "_")}_${ordinal}`,
      _creationTime: ordinal,
      openalexId: `oa:${titlePrefix.toLowerCase().replace(/\s+/g, "_")}:${ordinal}`,
      title: `${titlePrefix} ${ordinal}`,
      rating: 3,
      savedAt: 1000 + ordinal,
    };
  });
}

function resolveFixture<T>(
  fixture: T | ((args: unknown) => T),
  args: unknown,
): T {
  return typeof fixture === "function"
    ? (fixture as (args: unknown) => T)(args)
    : fixture;
}

function buildPaginatedResult({
  results,
  status,
  loadMore,
}: PaginatedFixture & { loadMore: (numItems: number) => void }) {
  return {
    results,
    status,
    loadMore,
    isLoading: false,
    isInitialLoading: false,
    hasLoadedFirstPage: true,
    isSettled: true,
    phase: "authenticated" as const,
    isDeferred: status === "Deferred",
    isReady: status !== "Deferred",
    isAnonymous: false,
    settlement: "ready" as const,
  };
}

function setProtectedQueryFixture<T>(
  queryRef: unknown,
  fixture: T | ((args: unknown) => T),
) {
  queryFixtureStore.protected[String(queryRef)] = fixture;
}

function setPaginatedQueryFixture(
  queryRef: unknown,
  fixture: PaginatedFixture | ((args: unknown) => PaginatedFixture),
) {
  queryFixtureStore.paginated[String(queryRef)] = fixture;
}

function resetQueryFixtures() {
  queryFixtureStore.protected = {};
  queryFixtureStore.paginated = {};

  setProtectedQueryFixture(api.library.collections.getCollection, null);
  setProtectedQueryFixture(api.library.queries.getLibraryCount, 42);
  setProtectedQueryFixture(
    api.library.queries.getLibraryFilteredCount,
    (args: unknown) => {
      const filters = args as {
        collectionId?: string;
        searchText?: string;
      };
      if (filters.collectionId === "collection_1") {
        return { count: 84, capped: false };
      }
      if (filters.searchText === "machine") {
        return { count: 25, capped: false };
      }
      return { count: 42, capped: false };
    },
  );
  setPaginatedQueryFixture(api.library.queries.browseLibrary, {
    results: buildItems(20),
    status: "CanLoadMore",
  });
  setPaginatedQueryFixture(api.library.queries.searchLibrary, {
    results: [],
    status: "Exhausted",
  });
}

function configureProtectedQueryMocks() {
  protectedQueryMock.mockImplementation((queryRef: unknown, args: unknown) => {
    const fixture = queryFixtureStore.protected[String(queryRef)] as
      | unknown
      | ((fixtureArgs: unknown) => unknown)
      | undefined;
    if (fixture === undefined) {
      throw new Error(`Unexpected protected query: ${String(queryRef)}`);
    }
    return readyQueryResult(resolveFixture(fixture, args));
  });
}

function configurePaginatedMocks() {
  protectedPaginatedQueryMock.mockImplementation(
    (queryRef: unknown, args: unknown) => {
      const loadMore =
        queryRef === api.library.queries.searchLibrary
          ? searchLoadMoreMock
          : browseLoadMoreMock;

      if (args === "skip") {
        return buildPaginatedResult({
          results: [],
          status: "Deferred",
          loadMore,
        });
      }

      const fixture = queryFixtureStore.paginated[String(queryRef)] as
        | PaginatedFixture
        | ((fixtureArgs: unknown) => PaginatedFixture)
        | undefined;
      if (fixture === undefined) {
        throw new Error(`Unexpected paginated query: ${String(queryRef)}`);
      }

      return buildPaginatedResult({
        ...resolveFixture(fixture, args),
        loadMore,
      });
    },
  );
}

function seedCollectionScopedCounts() {
  setProtectedQueryFixture(api.library.collections.getCollection, { _id: "collection_1", name: "Focus set", itemCount: 84 });
  setProtectedQueryFixture(api.library.queries.getLibraryCount, 86);
  setProtectedQueryFixture(api.library.queries.getLibraryFilteredCount, { count: 84, capped: false });
  setPaginatedQueryFixture(api.library.queries.browseLibrary, {
    results: buildItems(20, { titlePrefix: "Focus Paper" }),
    status: "Exhausted",
  });
}

function seedSearchThenBrowseFixtures() {
  setProtectedQueryFixture(api.library.queries.getLibraryCount, 42);
  setProtectedQueryFixture(
    api.library.queries.getLibraryFilteredCount,
    (args: unknown) => {
      const filters = args as { searchText?: string };
      return { count: filters.searchText === "machine" ? 25 : 42, capped: false };
    },
  );
  setPaginatedQueryFixture(api.library.queries.searchLibrary, {
    results: buildItems(25, { titlePrefix: "Search Paper" }),
    status: "Exhausted",
  });
  setPaginatedQueryFixture(api.library.queries.browseLibrary, {
    results: buildItems(20, { titlePrefix: "Browse Paper" }),
    status: "Exhausted",
  });
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
    resetQueryFixtures();
    configureProtectedQueryMocks();
    configurePaginatedMocks();
    convexQueryMock.mockImplementation(async (_query, args: { paginationOpts: { cursor: string | null } }) =>
      args.paginationOpts.cursor === null
        ? { page: buildItems(25).slice(0, 20), isDone: false, continueCursor: "page-2" }
        : { page: buildItems(25).slice(20), isDone: true, continueCursor: "" });
  });

  it("mounts browseLibrary through the protected paginated wrapper", () => {
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
    setPaginatedQueryFixture(api.library.queries.searchLibrary, {
      results: buildItems(2, { titlePrefix: "Search Paper" }),
      status: "Exhausted",
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

  it("exports the whole view by reading it page by page", async () => {
    render(<LibraryPageClient />);

    expect(convexQueryMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "export csv" }));

    await waitFor(() => {
      expect(exportCsvMock).toHaveBeenCalledWith(buildItems(25));
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(2);
    expect(convexQueryMock.mock.calls[0][0]).toBe(api.library.queries.browseLibrary);
    expect(convexQueryMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        sortBy: "savedAt",
        sortOrder: "desc",
        paginationOpts: expect.objectContaining({ cursor: "page-2" }),
      }),
    );
  });

  it("shows a count that stopped before the end as at least that many", () => {
    queryStateStore.value.rmin = 4;
    setProtectedQueryFixture(api.library.queries.getLibraryFilteredCount, { count: 1000, capped: true });
    setPaginatedQueryFixture(api.library.queries.browseLibrary, {
      results: buildItems(20),
      status: "CanLoadMore",
    });

    render(<LibraryPageClient />);

    expect(screen.getByText("Showing 1-20 of 1000+ papers")).toBeInTheDocument();
  });

  it("renders exact collection totals and range copy", () => {
    queryStateStore.value.col = "collection_1";
    seedCollectionScopedCounts();

    render(<LibraryPageClient />);

    expect(screen.getByText("84 / 86 results")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 1-20 of 84 papers"),
    ).toBeInTheDocument();
  });

  it("resets from search page two back to browse page one when search is cleared", async () => {
    queryStateStore.value.q = "machine";
    queryStateStore.value.p = 2;
    seedSearchThenBrowseFixtures();

    render(<LibraryPageClient />);

    expect(screen.getByText("Showing 21-25 of 25 papers")).toBeInTheDocument();
    expect(screen.getByText("Search Paper 21")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1-20 of 42 papers")).toBeInTheDocument();
    });
    expect(screen.getByText("Browse Paper 1")).toBeInTheDocument();
    expect(screen.queryByText("Search Paper 21")).not.toBeInTheDocument();
    expect(setQueryStateSpy).toHaveBeenCalledWith({ q: "", p: 1 }, undefined);
  });
});
