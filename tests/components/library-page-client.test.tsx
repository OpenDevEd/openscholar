import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { LibraryPageClient } from "@/components/library/library-page-client";

type LibraryQueryState = {
  q: string;
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
      exports: { start: "library:exports:start" },
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
  protectedQueryMock,
  pageReadsMock,
  startExportMock,
  queryStateStore,
  queryFixtureStore,
  setQueryStateSpy,
} = vi.hoisted(() => ({
  protectedQueryMock: vi.fn(),
  pageReadsMock: vi.fn(),
  startExportMock: vi.fn(),
  queryStateStore: {
    value: {
      q: "",
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
    // Each paged query's rows, paged by offset cursors; a read is cached by its arguments,
    // so a page keeps its identity across renders as Convex's does.
    rows: {} as Record<string, unknown>,
    reads: new Map<string, unknown>(),
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
  useConvex: () => ({
    mutation: startExportMock,
    watchQuery: () => ({ onUpdate: () => () => {}, localQueryResult: () => ({ part: 1, serving: false, failed: false }) }),
  }),
  useQueries: (requests: Record<string, { query: unknown; args: { paginationOpts: { cursor: string | null; numItems: number } } }>) =>
    Object.fromEntries(Object.entries(requests).map(([name, { query, args }]) => [name, readPage(query, args)])),
}));

vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => ({ canRunProtectedQueries: true }),
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: protectedQueryMock,
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

type Rows = ReturnType<typeof buildItems>;

function resolveFixture<T>(
  fixture: T | ((args: unknown) => T),
  args: unknown,
): T {
  return typeof fixture === "function"
    ? (fixture as (args: unknown) => T)(args)
    : fixture;
}

function readPage(query: unknown, args: { paginationOpts: { cursor: string | null; numItems: number } }) {
  pageReadsMock(query, args);
  const key = `${String(query)}|${JSON.stringify(args)}`;
  if (!queryFixtureStore.reads.has(key)) {
    const fixture = queryFixtureStore.rows[String(query)] as Rows | ((args: unknown) => Rows) | undefined;
    if (fixture === undefined) throw new Error(`Unexpected paged query: ${String(query)}`);
    const rows = resolveFixture(fixture, args);
    const start = Number(args.paginationOpts.cursor ?? 0);
    const end = start + args.paginationOpts.numItems;
    queryFixtureStore.reads.set(key, { page: rows.slice(start, end), isDone: end >= rows.length, continueCursor: String(end) });
  }
  return queryFixtureStore.reads.get(key);
}

function setProtectedQueryFixture<T>(
  queryRef: unknown,
  fixture: T | ((args: unknown) => T),
) {
  queryFixtureStore.protected[String(queryRef)] = fixture;
}

function setPagedRows(queryRef: unknown, rows: Rows | ((args: unknown) => Rows)) {
  queryFixtureStore.rows[String(queryRef)] = rows;
}

function resetQueryFixtures() {
  queryFixtureStore.protected = {};
  queryFixtureStore.rows = {};
  queryFixtureStore.reads = new Map();

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
  setPagedRows(api.library.queries.browseLibrary, buildItems(42));
  setPagedRows(api.library.queries.searchLibrary, []);
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

function seedCollectionScopedCounts() {
  setProtectedQueryFixture(api.library.collections.getCollection, { _id: "collection_1", name: "Focus set", itemCount: 84 });
  setProtectedQueryFixture(api.library.queries.getLibraryCount, 86);
  setProtectedQueryFixture(api.library.queries.getLibraryFilteredCount, { count: 84, capped: false });
  setPagedRows(api.library.queries.browseLibrary, buildItems(84, { titlePrefix: "Focus Paper" }));
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
  setPagedRows(api.library.queries.searchLibrary, buildItems(25, { titlePrefix: "Search Paper" }));
  setPagedRows(api.library.queries.browseLibrary, buildItems(42, { titlePrefix: "Browse Paper" }));
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

/** The paged reads made of `query`, newest last. */
function readsOf(query: unknown) {
  return pageReadsMock.mock.calls.filter(([ref]) => ref === query).map(([, args]) => args as Record<string, unknown> & { paginationOpts: { cursor: string | null } });
}

describe("LibraryPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryStateStore.value = {
      q: "",
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
    startExportMock.mockResolvedValue(null);
  });

  it("reads one page of the view through browseLibrary, not the search", () => {
    render(<LibraryPageClient />);

    expect(readsOf(api.library.queries.browseLibrary).at(-1)).toEqual(
      expect.objectContaining({ sortBy: "savedAt", sortOrder: "desc", paginationOpts: expect.objectContaining({ cursor: null, numItems: 20 }) }),
    );
    expect(readsOf(api.library.queries.searchLibrary)).toEqual([]);
    expect(screen.getByText("Showing 1-20 of 42 papers")).toBeInTheDocument();
  });

  it("steps to the next page from where the first one ended", () => {
    render(<LibraryPageClient />);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(readsOf(api.library.queries.browseLibrary).at(-1)?.paginationOpts).toEqual(expect.objectContaining({ cursor: "20" }));
    expect(screen.getByText("Showing 21-40 of 42 papers")).toBeInTheDocument();
    expect(screen.getByText("Paper 21")).toBeInTheDocument();
  });

  it("routes active search through searchLibrary with sort args", () => {
    queryStateStore.value.q = "machine";
    setPagedRows(api.library.queries.searchLibrary, buildItems(2, { titlePrefix: "Search Paper" }));

    render(<LibraryPageClient />);

    expect(readsOf(api.library.queries.browseLibrary)).toEqual([]);
    expect(readsOf(api.library.queries.searchLibrary).at(-1)).toEqual(
      expect.objectContaining({ searchText: "machine", sortBy: "savedAt", sortOrder: "desc", paginationOpts: expect.objectContaining({ numItems: 20 }) }),
    );
  });

  it("starts an export of the view with a token's digest and downloads its first part in a hidden frame", async () => {
    queryStateStore.value.rmin = 2;
    render(<LibraryPageClient />);

    fireEvent.click(screen.getByRole("button", { name: "export csv" }));

    await waitFor(() => expect(startExportMock).toHaveBeenCalledTimes(1));
    const [mutation, { digest, format, view }] = startExportMock.mock.calls[0];
    expect(mutation).toBe(api.library.exports.start);
    expect(format).toBe("csv");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(view).toEqual(expect.objectContaining({ sortBy: "savedAt", sortOrder: "desc", minRating: 2 }));
    await waitFor(() => expect(document.querySelector("iframe")?.getAttribute("src")).toMatch(/\/library\/export\?token=[\w-]{43}&part=1$/));
  });

  it("shows a count that stopped before the end as at least that many", () => {
    queryStateStore.value.rmin = 4;
    setProtectedQueryFixture(api.library.queries.getLibraryFilteredCount, { count: 1000, capped: true });

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

  it("goes back to browse page one when a search on its second page is cleared", async () => {
    queryStateStore.value.q = "machine";
    seedSearchThenBrowseFixtures();

    render(<LibraryPageClient />);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(screen.getByText("Showing 21-25 of 25 papers")).toBeInTheDocument();
    expect(screen.getByText("Search Paper 21")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => {
      expect(screen.getByText("Showing 1-20 of 42 papers")).toBeInTheDocument();
    });
    expect(screen.getByText("Browse Paper 1")).toBeInTheDocument();
    expect(screen.queryByText("Search Paper 21")).not.toBeInTheDocument();
    expect(setQueryStateSpy).toHaveBeenCalledWith({ q: "" }, undefined);
  });
});
