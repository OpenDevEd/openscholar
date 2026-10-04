import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import JobDetailPage from "../page";
import * as authQuery from "@/lib/auth/use-auth-query";

const {
  pushMock,
  currentJobIdMock,
  resultsFiltersSpy,
  smartPaginationSpy,
  exportDialogSpy,
  convexQueryMock,
} = vi.hoisted(() => ({
  convexQueryMock: vi.fn(),
  pushMock: vi.fn(),
  currentJobIdMock: { value: "job_1" },
  resultsFiltersSpy: vi.fn(
    ({
      onFiltersChange,
    }: {
      onFiltersChange: (
        next:
          | {
              searchQuery: string;
              confidenceRange: [number, number];
              statusFilters: Set<string>;
              questionFilters: Map<string, string>;
            }
          | ((
              prev: {
                searchQuery: string;
                confidenceRange: [number, number];
                statusFilters: Set<string>;
                questionFilters: Map<string, string>;
              },
            ) => {
              searchQuery: string;
              confidenceRange: [number, number];
              statusFilters: Set<string>;
              questionFilters: Map<string, string>;
            }),
      ) => void;
    }) => (
      <div data-testid="results-filters">
        <button
          type="button"
          onClick={() =>
            onFiltersChange((prev) => ({
              ...prev,
              searchQuery: "Paper 250",
            }))
          }
        >
          filter to Paper 250
        </button>
      </div>
    ),
  ),
  smartPaginationSpy: vi.fn(
    ({
      currentPage,
      pageSize,
      totalCount,
      filteredCount,
      displayedCount,
      onNext,
      onPageSizeChange,
    }: {
      currentPage: number;
      pageSize: number;
      totalCount: number;
      filteredCount: number;
      displayedCount: number;
      onNext: () => void;
      onPageSizeChange: (pageSize: number) => void;
    }) => (
      <div
        data-testid="smart-pagination"
        data-current-page={String(currentPage)}
        data-page-size={String(pageSize)}
        data-total-count={String(totalCount)}
        data-filtered-count={String(filteredCount)}
        data-displayed-count={String(displayedCount)}
      >
        <button type="button" onClick={onNext}>
          next page
        </button>
        <button type="button" onClick={() => onPageSizeChange(25)}>
          set page size 25
        </button>
      </div>
    ),
  ),
  exportDialogSpy: vi.fn(
    ({
      paperCount,
    }: {
      paperCount: number;
      loadPapers: () => Promise<Array<{ _id: string }>>;
    }) => (
      <div
        data-testid="export-dialog"
        data-papers-count={String(paperCount)}
      />
    ),
  ),
}));

type MockJobDetailsData = {
  status: "ok";
  job: {
    _id: string;
    mode: "chat" | "extraction";
    chatThreadId?: string;
    name: string;
    sourceType: string;
    messageCount: number;
    status?: "pending" | "extracting" | "completed";
    totalPapers?: number;
    usePdfs?: boolean;
    createdAt: number;
    updatedAt: number;
  };
  questions: [];
  papers: [];
  progress: {
    total: number;
    processed: number;
    failed: number;
    percentage: number;
  };
};

type MockQueryResult = {
  data: MockJobDetailsData;
  phase: "authenticated";
  isDeferred: boolean;
  isReady: boolean;
  isAnonymous: boolean;
  settlement: "ready";
};

const mockQueryResult: MockQueryResult = {
  data: {
    status: "ok",
    job: {
      _id: "job_1",
      mode: "chat",
      chatThreadId: "thread_1",
      name: "Chat job",
      sourceType: "history",
      messageCount: 0,
      createdAt: 0,
      updatedAt: 0,
    },
    questions: [],
    papers: [],
    progress: {
      total: 0,
      processed: 0,
      failed: 0,
      percentage: 0,
    },
  },
  phase: "authenticated" as const,
  isDeferred: false,
  isReady: true,
  isAnonymous: false,
  settlement: "ready" as const,
};

const mockSkippedQueryResult = {
  data: undefined,
  phase: "authenticated" as const,
  isDeferred: false,
  isReady: true,
  isAnonymous: false,
  settlement: "ready" as const,
};

type MockSkippedQueryResult = typeof mockSkippedQueryResult;
type MockProtectedQueryHookResult = MockQueryResult | MockSkippedQueryResult;

function buildPageRows(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return {
      _id: `paper_${n}`,
      _creationTime: n,
      jobId: "job_1",
      openalexId: `oa:${n}`,
      title: `Paper ${n}`,
      status: "completed" as const,
      processable: true,
      results: [],
    };
  });
}

const extractionJobQueryResult: MockQueryResult = {
  ...mockQueryResult,
  data: {
    status: "ok",
    job: {
      _id: "job_1",
      mode: "extraction",
      name: "Extraction job",
      sourceType: "history",
      messageCount: 0,
      status: "completed",
      totalPapers: 293,
      usePdfs: false,
      createdAt: 0,
      updatedAt: 0,
    },
    questions: [],
    papers: [],
    progress: {
      total: 293,
      processed: 200,
      failed: 0,
      percentage: 68,
    },
  },
};

const extractionSharedProtectedQueryResult = {
  ...mockQueryResult,
  data: {
    ...extractionJobQueryResult.data,
    totalPapers: 293,
    processedPapers: 200,
    failedPapers: 0,
  },
} as unknown as MockProtectedQueryHookResult;

type ResultsView = { filters: { searchQuery?: string }; paginationOpts?: { cursor: string | null; numItems: number } };

/** The job's papers as the server lists them for a view: all 293, or the one a search keeps. */
const serverRows = (view: ResultsView) => (view.filters.searchQuery === "Paper 250" ? buildPageRows(250, 1) : buildPageRows(1, 293));

/** The job's shared queries, and the count of the papers a filtered view keeps. */
function mockExtractionQueries() {
  (
    authQuery.useProtectedQuery as unknown as {
      mockImplementation: (fn: (query: unknown, args: unknown) => MockProtectedQueryHookResult) => void;
    }
  ).mockImplementation((_query, args) => {
    if (args === "skip") return mockSkippedQueryResult;
    if (typeof args === "object" && args !== null && "filters" in args) {
      return { ...mockQueryResult, data: { all: 293, matching: serverRows(args as ResultsView).length } } as unknown as MockProtectedQueryHookResult;
    }
    return extractionSharedProtectedQueryResult;
  });
}

// The page hook over the list the test holds whole: one page of it, stepped by number.
vi.mock("@/lib/hooks/use-cursor-page", async () => {
  const { useState } = await import("react");
  return {
    useCursorPage: (_query: unknown, args: ResultsView | "skip", pageSize: number) => {
      const key = JSON.stringify([args, pageSize]);
      const [at, setAt] = useState({ key, page: 1 });
      const page = at.key === key ? at.page : 1;
      const rows = args === "skip" ? [] : serverRows(args);
      const offset = (page - 1) * pageSize;
      return {
        items: rows.slice(offset, offset + pageSize),
        isLoading: false,
        isStale: false,
        page,
        offset,
        hasPages: rows.length > pageSize,
        canPrevious: page > 1,
        canNext: offset + pageSize < rows.length,
        previous: () => setAt({ key, page: page - 1 }),
        next: () => setAt({ key, page: page + 1 }),
      };
    },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
  useFormatter: () => ({
    number: (value: number) => String(value),
    relativeTime: () => "now",
  }),
  useNow: () => new Date("2026-04-19T00:00:00.000Z"),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ jobId: currentJobIdMock.value }),
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: convexQueryMock }),
}));

vi.mock("motion/react", () => {
  const motion = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: ComponentProps<"div">) =>
          <div {...props}>{children}</div>,
    },
  );
  return { motion };
});

vi.mock("@/components/PageWrapper", () => ({
  PageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipHint: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/command-center", () => ({
  CommandCenterContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/layout/two-column-layout", () => ({
  TwoColumnLayout: ({ leftColumn, rightColumn }: { leftColumn: ReactNode; rightColumn: ReactNode }) => (
    <div>
      <div>{leftColumn}</div>
      <div>{rightColumn}</div>
    </div>
  ),
}));

vi.mock("@/components/extraction/results-toolbar", () => ({
  ResultsFilters: resultsFiltersSpy,
  ResultsViewSwitch: () => null,
  ResultsFilterMenu: () => null,
  ResultsColumnsMenu: () => null,
}));

vi.mock("@/components/extraction/results-views", () => ({
  TableView: ({
    papers,
  }: {
    papers: Array<{ _id: string; title: string }>;
  }) => (
    <div data-testid="table-view">
      {papers.map((paper) => (
        <div key={paper._id}>{paper.title}</div>
      ))}
    </div>
  ),
  CardView: () => <div>card view</div>,
  SplitView: () => <div>split view</div>,
}));

vi.mock("@/components/extraction/smart-pagination", () => ({
  SmartPagination: smartPaginationSpy,
}));

vi.mock("@/components/extraction/bulk-actions-bar", () => ({
  BulkActionsBar: () => <div>bulk actions</div>,
}));

vi.mock("@/components/extraction/export-dialog", () => ({
  ExportDialog: exportDialogSpy,
}));

vi.mock("@/components/extraction/extraction-results-shell", () => ({
  ExtractionResultsShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="extraction-results-shell">{children}</div>
  ),
}));

vi.mock("@/components/extraction/extraction-citation-sidebar", () => ({
  ExtractionCitationSidebar: () => <div>citation sidebar</div>,
}));

vi.mock("@/components/extraction/chat/chat-job-view", () => ({
  ChatJobView: ({
    threadId,
  }: {
    threadId: string;
  }) => <div data-testid="chat-job-view" data-thread-id={threadId} />,
}));


vi.mock("@/components/extraction/cost-badge", () => ({
  CostBadge: () => <div>cost badge</div>,
}));

vi.mock("@/components/extraction/credits-exhausted-banner", () => ({
  CreditsExhaustedBanner: () => null,
}));

vi.mock("@/components/extraction/job-status-banner", () => ({
  JobStatusBanner: () => null,
}));

vi.mock("@/components/extraction/now-processing", () => ({
  NowProcessing: () => null,
}));

vi.mock("@/components/extraction/mixed-success-summary", () => ({
  MixedSuccessSummary: () => null,
}));

vi.mock("@/components/extraction/retry-summary", () => ({
  RetrySummary: () => null,
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({
    variant,
    loadingStyle,
    title,
  }: {
    variant: string;
    loadingStyle?: string;
    title?: string;
  }) => (
    <div
      data-testid={`auth-state-${variant}`}
      data-loading-style={loadingStyle}
      data-title={title}
    />
  ),
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => false,
}));

vi.mock("@/lib/hooks", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/hooks/use-url-state", () => ({
  useUrlState: () => ["table", vi.fn()],
}));

vi.mock("@/lib/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));

vi.mock("@/lib/hooks/use-selection", () => ({
  useSelection: () => ({
    selectedIds: new Set<string>(),
    clearSelection: vi.fn(),
    setSelection: vi.fn(),
  }),
}));

vi.mock("@/lib/toast", () => ({
  useAppToast: () => ({
    job: {
      cancelFailed: vi.fn(),
      deleteFailed: vi.fn(),
      createFailed: vi.fn(),
    },
  }),
}));

vi.mock("@/lib/store", () => ({
  useExtractionCitationPanelStore: () => ({
    expand: vi.fn(),
  }),
}));

vi.mock("@/lib/extraction/filtering", () => ({
  defaultFilters: {
    searchQuery: "",
    confidenceRange: [0, 100],
    statusFilters: new Set<string>(),
    questionFilters: new Map<string, string>(),
  },
}));

vi.mock("@/lib/auth/list-render-state", () => ({
  getAuthSensitiveListRenderState: () => "empty",
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: vi.fn(),
}));

describe("JobDetailPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    currentJobIdMock.value = "job_1";
    resultsFiltersSpy.mockClear();
    smartPaginationSpy.mockClear();
    exportDialogSpy.mockClear();

    (
      authQuery.useProtectedQuery as unknown as {
        mockImplementation: (
          fn: (
            query: typeof api.extraction.queries.getJobDetails,
            args: unknown,
          ) => MockProtectedQueryHookResult,
        ) => void;
      }
    ).mockImplementation((_query, args) => {
      return args === "skip" ? mockSkippedQueryResult : mockQueryResult;
    });
  });

  it("renders the chat job view without ever mounting extraction-only UI", () => {
    render(<JobDetailPage />);

    const mountedJobDetailsCalls = (
      authQuery.useProtectedQuery as unknown as {
        mock: {
          calls: Array<[unknown, unknown]>;
        };
      }
    ).mock.calls.filter(
      ([query, args]) =>
        query === api.extraction.queries.getJobDetails && args !== "skip",
    );

    expect(screen.getByTestId("chat-job-view")).toHaveAttribute(
      "data-thread-id",
      "thread_1",
    );
    expect(mountedJobDetailsCalls).toHaveLength(0);
    expect(document.querySelector('[data-job-mode="chat"]')).not.toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).toBeNull();
    expect(resultsFiltersSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("results-filters")).toBeNull();
    expect(screen.queryByText("extractionResults")).toBeNull();
    expect(screen.queryByText("insights")).toBeNull();
    expect(screen.queryByText("reviewQueue")).toBeNull();
    expect(screen.queryByText("reportBuilder")).toBeNull();
  });

  it("renders the extraction route without mounting the chat shell", () => {
    mockExtractionQueries();

    render(<JobDetailPage />);

    expect(document.querySelector('[data-job-mode="chat"]')).toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).not.toBeNull();
    expect(screen.getByTestId("extraction-results-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-job-view")).toBeNull();
    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-total-papers", "293");
    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-filtered-papers", "293");
  });

  it("keeps showing the shared loading spinner while stale job shell data do not match the route", () => {
    currentJobIdMock.value = "job_2";

    (
      authQuery.useProtectedQuery as unknown as {
        mockImplementation: (
          fn: (
            query: unknown,
            args: unknown,
          ) => MockProtectedQueryHookResult,
        ) => void;
      }
    ).mockImplementation((_query, args) => {
      if (args === "skip") return mockSkippedQueryResult;
      return {
        ...mockQueryResult,
        data: {
          ...mockQueryResult.data,
          job: {
            ...mockQueryResult.data.job,
            _id: "job_1",
            mode: "extraction" as const,
            chatThreadId: undefined,
          },
        },
      } as MockQueryResult;
    });

    render(<JobDetailPage />);

    expect(screen.getByRole("status", { name: "loadingExtractionResults" })).toBeInTheDocument();
    expect(document.querySelector('[data-job-mode="chat"]')).toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).toBeNull();
    expect(resultsFiltersSpy).not.toHaveBeenCalled();
  });

  it("uses the shared spinner loading state while a chat thread is preparing", () => {
    (
      authQuery.useProtectedQuery as unknown as {
        mockImplementation: (
          fn: (
            query: unknown,
            args: unknown,
          ) => MockProtectedQueryHookResult,
        ) => void;
      }
    ).mockImplementation((_query, args) => {
      if (args === "skip") return mockSkippedQueryResult;
      return {
        ...mockQueryResult,
        data: {
          ...mockQueryResult.data,
          job: {
            ...mockQueryResult.data.job,
            chatThreadId: undefined,
          },
        },
      } as MockQueryResult;
    });

    render(<JobDetailPage />);

    expect(document.querySelector('[data-chat-state="preparing"]')).not.toBeNull();
    expect(screen.getByTestId("auth-state-loading")).toHaveAttribute(
      "data-loading-style",
      "spinner",
    );
    expect(screen.getByTestId("auth-state-loading")).toHaveAttribute(
      "data-title",
      "chatPreparing",
    );
    expect(resultsFiltersSpy).not.toHaveBeenCalled();
  });

  it("shows the full server filtered count while keeping the progress bar total authoritative", () => {
    mockExtractionQueries();

    render(<JobDetailPage />);

    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-total-papers", "293");
    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-filtered-papers", "293");
    expect(screen.queryByText("overviewQuestions")).toBeNull();
    expect(screen.queryByText("insights")).toBeNull();
    expect(screen.queryByText("reviewQueue")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuemax",
      "293",
    );
  });

  it("steps to page 2 and renders rows 201-293 from the server page query", () => {
    mockExtractionQueries();

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "next page" }));

    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-total-papers", "293");
    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-filtered-papers", "293");
    expect(smartPaginationSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentPage: 2,
        offset: 200,
        displayedCount: 93,
        filteredCount: 293,
      }),
      undefined,
    );
  });

  it("keeps full-corpus counts truthful after switching to page size 25 and filtering on the server", () => {
    mockExtractionQueries();

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "set page size 25" }));
    fireEvent.click(screen.getAllByRole("button", { name: "filter to Paper 250" })[0]);

    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-total-papers", "293");
    expect(document.querySelector("[data-results-scope]")).toHaveAttribute("data-filtered-papers", "1");
    expect(smartPaginationSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pageSize: 25,
        filteredCount: 1,
        displayedCount: 1,
      }),
      undefined,
    );
    expect(
      document.querySelector('[data-results-scope="full"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-filtered-papers="1"]'),
    ).not.toBeNull();
  });

  it("opens export-all with the full filtered corpus instead of the current page rows", async () => {
    mockExtractionQueries();

    convexQueryMock.mockImplementation(async (_query, args: ResultsView) => {
      const rows = serverRows(args);
      if (!args.paginationOpts) return { all: 293, matching: rows.length };
      const start = Number(args.paginationOpts.cursor ?? 0);
      const page = rows.slice(start, start + args.paginationOpts.numItems);
      return { page, isDone: start + page.length >= rows.length, continueCursor: String(start + page.length) };
    });

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "set page size 25" }));
    fireEvent.click(screen.getByRole("button", { name: "export" }));

    expect(screen.getByTestId("export-dialog")).toHaveAttribute(
      "data-papers-count",
      "293",
    );
    expect(screen.getByTestId("smart-pagination")).toHaveAttribute(
      "data-displayed-count",
      "25",
    );
    // The export reads every page of the filtered view, not the 25 rows on screen.
    const papers = await exportDialogSpy.mock.lastCall![0].loadPapers();
    expect(papers.map((paper) => paper._id)).toEqual(buildPageRows(1, 293).map((paper) => paper._id));
  });
});
