import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import JobDetailPage from "../page";
import * as authQuery from "@/lib/auth/use-auth-query";

const {
  pushMock,
  currentJobIdMock,
  resultsToolbarSpy,
  smartPaginationSpy,
  exportDialogSpy,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  currentJobIdMock: { value: "job_1" },
  resultsToolbarSpy: vi.fn(
    ({
      totalCount,
      filteredCount,
      onFiltersChange,
      onExportAll,
    }: {
      totalCount: number;
      filteredCount: number;
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
      onExportAll: () => void;
    }) => (
      <div
        data-testid="results-toolbar"
        data-total-count={String(totalCount)}
        data-filtered-count={String(filteredCount)}
      >
        {filteredCount} of {totalCount} papers
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
        <button type="button" onClick={onExportAll}>
          export all
        </button>
      </div>
    ),
  ),
  smartPaginationSpy: vi.fn(
    ({
      currentPage,
      totalPages,
      pageSize,
      totalCount,
      filteredCount,
      displayedCount,
      onPageChange,
      onPageSizeChange,
    }: {
      currentPage: number;
      totalPages: number;
      pageSize: number;
      totalCount: number;
      filteredCount: number;
      displayedCount: number;
      onPageChange: (page: number) => void;
      onPageSizeChange: (pageSize: number) => void;
    }) => (
      <div
        data-testid="smart-pagination"
        data-current-page={String(currentPage)}
        data-total-pages={String(totalPages)}
        data-page-size={String(pageSize)}
        data-total-count={String(totalCount)}
        data-filtered-count={String(filteredCount)}
        data-displayed-count={String(displayedCount)}
      >
        <button type="button" onClick={() => onPageChange(2)}>
          go to page 2
        </button>
        <button type="button" onClick={() => onPageSizeChange(25)}>
          set page size 25
        </button>
      </div>
    ),
  ),
  exportDialogSpy: vi.fn(
    ({
      papers = [],
      isLoading,
    }: {
      papers?: Array<{ _id: string }>;
      isLoading?: boolean;
    }) => (
      <div
        data-testid="export-dialog"
        data-papers-count={String(papers.length)}
        data-loading={String(Boolean(isLoading))}
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
    processedPapers?: number;
    failedPapers?: number;
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
      processedPapers: 200,
      failedPapers: 0,
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

const extractionResultsPageQueryResult = {
  "1:200:": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 293,
    totalPages: 2,
    page: 1,
    pageSize: 200,
    items: buildPageRows(1, 200),
  },
  "2:200:": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 293,
    totalPages: 2,
    page: 2,
    pageSize: 200,
    items: buildPageRows(201, 93),
  },
  "1:25:": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 293,
    totalPages: 12,
    page: 1,
    pageSize: 25,
    items: buildPageRows(1, 25),
  },
  "1:200:Paper 250": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 1,
    totalPages: 1,
    page: 1,
    pageSize: 200,
    items: buildPageRows(250, 1),
  },
  "1:25:Paper 250": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 1,
    totalPages: 1,
    page: 1,
    pageSize: 25,
    items: buildPageRows(250, 1),
  },
} as const;

const extractionResultsExportQueryResult = {
  "": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 293,
    items: buildPageRows(1, 293),
  },
  "Paper 250": {
    status: "ok" as const,
    totalAll: 293,
    totalFiltered: 1,
    items: buildPageRows(250, 1),
  },
} as const;

type MockResultsPageData =
  (typeof extractionResultsPageQueryResult)[keyof typeof extractionResultsPageQueryResult];
type MockResultsExportData =
  (typeof extractionResultsExportQueryResult)[keyof typeof extractionResultsExportQueryResult];

function buildResultsPageHookResult(data: MockResultsPageData) {
  return {
    ...mockQueryResult,
    data,
  } as unknown as MockProtectedQueryHookResult;
}

function buildResultsExportHookResult(data: MockResultsExportData) {
  return {
    ...mockQueryResult,
    data,
  } as unknown as MockProtectedQueryHookResult;
}

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
  ResultsToolbar: resultsToolbarSpy,
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

vi.mock("@/components/extraction/report-builder", () => ({
  ReportBuilder: () => <div>report builder</div>,
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

vi.mock("@/components/extraction/completion-toast-observer", () => ({
  CompletionToastObserver: () => null,
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
    resultsToolbarSpy.mockClear();
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
    expect(resultsToolbarSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("results-toolbar")).toBeNull();
    expect(screen.queryByText("extractionResults")).toBeNull();
    expect(screen.queryByText("insights")).toBeNull();
    expect(screen.queryByText("reviewQueue")).toBeNull();
    expect(screen.queryByText("reportBuilder")).toBeNull();
  });

  it("renders the extraction route without mounting the chat shell", () => {
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
      if (
        typeof args === "object" &&
        args !== null &&
        "page" in args &&
        "pageSize" in args &&
        "filters" in args
      ) {
        const {
          page,
          pageSize,
          filters,
        } = args as {
          page: number;
          pageSize: number;
          filters: { searchQuery?: string };
        };
        return {
          ...buildResultsPageHookResult(
            extractionResultsPageQueryResult[
              `${page}:${pageSize}:${filters.searchQuery ?? ""}` as keyof typeof extractionResultsPageQueryResult
            ],
          ),
        };
      }
      return extractionSharedProtectedQueryResult;
    });

    render(<JobDetailPage />);

    expect(document.querySelector('[data-job-mode="chat"]')).toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).not.toBeNull();
    expect(screen.getByTestId("extraction-results-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-job-view")).toBeNull();
    expect(screen.getByTestId("results-toolbar")).toHaveTextContent(
      "293 of 293 papers",
    );
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

    expect(screen.getByTestId("auth-state-loading")).toHaveAttribute(
      "data-loading-style",
      "spinner",
    );
    expect(document.querySelector('[data-job-mode="chat"]')).toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).toBeNull();
    expect(resultsToolbarSpy).not.toHaveBeenCalled();
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
    expect(resultsToolbarSpy).not.toHaveBeenCalled();
  });

  it("shows the full server filtered count while keeping the progress bar total authoritative", () => {
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
      if (
        typeof args === "object" &&
        args !== null &&
        "page" in args &&
        "pageSize" in args &&
        "filters" in args
      ) {
        const {
          page,
          pageSize,
          filters,
        } = args as {
          page: number;
          pageSize: number;
          filters: { searchQuery?: string };
        };
        return {
          ...buildResultsPageHookResult(
            extractionResultsPageQueryResult[
              `${page}:${pageSize}:${filters.searchQuery ?? ""}` as keyof typeof extractionResultsPageQueryResult
            ],
          ),
        };
      }
      return extractionSharedProtectedQueryResult;
    });

    render(<JobDetailPage />);

    expect(screen.getByTestId("results-toolbar")).toHaveTextContent(
      "293 of 293 papers",
    );
    expect(screen.queryByText("overviewQuestions")).toBeNull();
    expect(screen.queryByText("insights")).toBeNull();
    expect(screen.queryByText("reviewQueue")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuemax",
      "293",
    );
  });

  it("navigates to page 2 and renders rows 201-293 from the server page query", () => {
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
      if (
        typeof args === "object" &&
        args !== null &&
        "page" in args &&
        "pageSize" in args &&
        "filters" in args
      ) {
        const {
          page,
          pageSize,
          filters,
        } = args as {
          page: number;
          pageSize: number;
          filters: { searchQuery?: string };
        };
        return {
          ...buildResultsPageHookResult(
            extractionResultsPageQueryResult[
              `${page}:${pageSize}:${filters.searchQuery ?? ""}` as keyof typeof extractionResultsPageQueryResult
            ],
          ),
        };
      }
      return extractionSharedProtectedQueryResult;
    });

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "go to page 2" }));

    expect(resultsToolbarSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        totalCount: 293,
        filteredCount: 293,
      }),
      undefined,
    );
    expect(smartPaginationSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentPage: 2,
        totalPages: 2,
        displayedCount: 93,
        filteredCount: 293,
      }),
      undefined,
    );
  });

  it("keeps full-corpus counts truthful after switching to page size 25 and filtering on the server", () => {
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
      if (
        typeof args === "object" &&
        args !== null &&
        "page" in args &&
        "pageSize" in args &&
        "filters" in args
      ) {
        const {
          page,
          pageSize,
          filters,
        } = args as {
          page: number;
          pageSize: number;
          filters: { searchQuery?: string };
        };
        return {
          ...buildResultsPageHookResult(
            extractionResultsPageQueryResult[
              `${page}:${pageSize}:${filters.searchQuery ?? ""}` as keyof typeof extractionResultsPageQueryResult
            ],
          ),
        };
      }
      return extractionSharedProtectedQueryResult;
    });

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "set page size 25" }));
    fireEvent.click(screen.getByRole("button", { name: "filter to Paper 250" }));

    expect(resultsToolbarSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        totalCount: 293,
        filteredCount: 1,
      }),
      undefined,
    );
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

  it("opens export-all with the full filtered corpus instead of the current page rows", () => {
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
      if (
        typeof args === "object" &&
        args !== null &&
        "filters" in args &&
        !("page" in args) &&
        !("pageSize" in args)
      ) {
        const { filters } = args as {
          filters: { searchQuery?: string };
        };
        return buildResultsExportHookResult(
          extractionResultsExportQueryResult[
            `${filters.searchQuery ?? ""}` as keyof typeof extractionResultsExportQueryResult
          ],
        );
      }
      if (
        typeof args === "object" &&
        args !== null &&
        "page" in args &&
        "pageSize" in args &&
        "filters" in args
      ) {
        const {
          page,
          pageSize,
          filters,
        } = args as {
          page: number;
          pageSize: number;
          filters: { searchQuery?: string };
        };
        return buildResultsPageHookResult(
          extractionResultsPageQueryResult[
            `${page}:${pageSize}:${filters.searchQuery ?? ""}` as keyof typeof extractionResultsPageQueryResult
          ],
        );
      }
      return extractionSharedProtectedQueryResult;
    });

    render(<JobDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "set page size 25" }));
    fireEvent.click(screen.getByRole("button", { name: "export all" }));

    expect(screen.getByTestId("export-dialog")).toHaveAttribute(
      "data-papers-count",
      "293",
    );
    expect(screen.getByTestId("smart-pagination")).toHaveAttribute(
      "data-displayed-count",
      "25",
    );
  });
});
