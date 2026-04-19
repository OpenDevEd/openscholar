import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import JobDetailPage from "../page";
import * as authQuery from "@/lib/auth/use-auth-query";

const {
  pushMock,
  currentJobIdMock,
  resultsToolbarSpy,
  paginatedQuerySpy,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  currentJobIdMock: { value: "job_1" },
  resultsToolbarSpy: vi.fn(() => (
    <div data-testid="results-toolbar">results toolbar</div>
  )),
  paginatedQuerySpy: vi.fn(),
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

const mockPaginatedResult = {
  results: [],
  status: "Deferred" as const,
  isLoading: false,
  loadMore: vi.fn(),
  isInitialLoading: false,
  hasLoadedFirstPage: true,
  isSettled: true,
  phase: "authenticated" as const,
  isDeferred: false,
  isReady: true,
  isAnonymous: false,
  settlement: "ready" as const,
};

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
  TableView: () => <div>table view</div>,
  CardView: () => <div>card view</div>,
  SplitView: () => <div>split view</div>,
}));

vi.mock("@/components/extraction/smart-pagination", () => ({
  SmartPagination: () => <div>pagination</div>,
}));

vi.mock("@/components/extraction/bulk-actions-bar", () => ({
  BulkActionsBar: () => <div>bulk actions</div>,
}));

vi.mock("@/components/extraction/export-dialog", () => ({
  ExportDialog: () => <div>export dialog</div>,
}));

vi.mock("@/components/extraction/insights-overview", () => ({
  InsightsOverview: () => <div>insights overview</div>,
}));

vi.mock("@/components/extraction/insights-question-panel", () => ({
  InsightsQuestionPanel: () => <div>insights question panel</div>,
}));

vi.mock("@/components/extraction/review-queue", () => ({
  ReviewQueue: () => <div>review queue</div>,
}));

vi.mock("@/components/extraction/report-builder", () => ({
  ReportBuilder: () => <div>report builder</div>,
}));

vi.mock("@/components/extraction/extraction-results-shell", () => ({
  ExtractionResultsShell: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
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
  filterPapers: (papers: unknown[]) => papers,
  preprocessPapers: () => ({}),
}));

vi.mock("@/lib/auth/list-render-state", () => ({
  getAuthSensitiveListRenderState: () => "empty",
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: vi.fn(),
  useProtectedPaginatedQuery: vi.fn(),
}));

describe("JobDetailPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    currentJobIdMock.value = "job_1";
    resultsToolbarSpy.mockClear();
    paginatedQuerySpy.mockClear();

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
      return args === "skip" ? mockSkippedQueryResult : mockQueryResult;
    });

    (
      authQuery.useProtectedPaginatedQuery as unknown as {
        mockImplementation: (
          fn: (...args: unknown[]) => typeof mockPaginatedResult,
        ) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
        paginatedQuerySpy(...args);
        return mockPaginatedResult;
      });
  });

  it("renders the chat job view without ever mounting extraction-only UI", () => {
    render(<JobDetailPage />);

    expect(screen.getByTestId("chat-job-view")).toHaveAttribute(
      "data-thread-id",
      "thread_1",
    );
    expect(document.querySelector('[data-job-mode="chat"]')).not.toBeNull();
    expect(document.querySelector('[data-job-mode="extraction"]')).toBeNull();
    expect(resultsToolbarSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("results-toolbar")).toBeNull();
    expect(screen.queryByText("extractionResults")).toBeNull();
    expect(screen.queryByText("insights")).toBeNull();
    expect(screen.queryByText("reviewQueue")).toBeNull();
    expect(screen.queryByText("reportBuilder")).toBeNull();
    expect(paginatedQuerySpy).toHaveBeenCalledWith(
      expect.anything(),
      "skip",
      expect.anything(),
    );
  });

  it("keeps showing the shared loading spinner while stale job details do not match the route", () => {
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
    expect(paginatedQuerySpy).toHaveBeenCalledWith(
      expect.anything(),
      "skip",
      expect.anything(),
    );
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
});
