/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchCommandFooter } from "@/components/search-command-center/search-command-footer";

const {
  authReadinessRef,
  currentUserIdRef,
  goToSignInMock,
  pushMock,
  searchHistoryRef,
  startJobMock,
  updateSearchResultMock,
  useQueryMock,
} = vi.hoisted(() => {
  const authReadinessRef = {
    current: {
      phase: "anonymous",
      isBootstrapping: false,
      canRunProtectedQueries: false,
      retryUserSync: vi.fn(),
    },
  };
  return {
    authReadinessRef,
    currentUserIdRef: { current: null as string | null },
    goToSignInMock: vi.fn(),
    pushMock: vi.fn(),
    searchHistoryRef: { current: [] as unknown[] },
    startJobMock: vi.fn(async () => ({ jobId: "job_for_current_account" })),
    updateSearchResultMock: vi.fn(),
    useQueryMock: vi.fn((queryRef: unknown, args?: unknown) => {
      if (queryRef === "organizationFeatures") return {extraction: true};
      return undefined;
    }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
  useFormatter: () => ({
    number: (value: number) => String(value),
  }),
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    span: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      layout: _layout,
      transition: _transition,
      ...props
    }: React.ComponentProps<"span"> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      layout?: unknown;
      transition?: unknown;
    }) => <span {...props}>{children}</span>,
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      layout: _layout,
      transition: _transition,
      ...props
    }: React.ComponentProps<"div"> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      layout?: unknown;
      transition?: unknown;
    }) => <div {...props}>{children}</div>,
  },
  useReducedMotion: () => true,
}));

vi.mock("lucide-react", () => ({
  Expand: () => null,
  Minimize2: () => null,
  Loader2: () => null,
  Eye: () => null,
  ChevronDown: () => null,
  ListChecks: () => null,
  Coins: () => null,
  MessageSquare: () => null,
  Check: () => null,
  Globe2: () => null,
  Sparkles: () => null,
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => startJobMock,
  useQuery: (queryRef: unknown, args?: unknown) => useQueryMock(queryRef, args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    organizationFeatures: {get: "organizationFeatures"},
    chat: {
      threads: {
        continueChatWithSourceRefresh: "continueChatWithSourceRefresh",
      },
    },
    extraction: {
      mutations: {
        startJob: "startJob",
      },
    },
  },
}));

vi.mock("@/components/providers/convex-provider", () => ({
  useAuthReadiness: () => authReadinessRef.current,
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: currentUserIdRef.current ? { id: currentUserIdRef.current } : null,
  }),
}));

vi.mock("@/lib/auth/use-sign-in-redirect", () => ({
  useSignInRedirect: () => goToSignInMock,
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => true,
}));

vi.mock("@/lib/search", () => ({
  useSearchOptional: () => ({
    params: {
      q: "graph neural networks",
      field: "title_and_abstract",
      sort: "relevance_score:desc",
      page: 1,
      yf: null,
      yt: null,
      df: null,
      dt: null,
      ft: "year",
      rmin: 0,
      rmax: 5,
      rated: false,
      reg: [],
      focus: [],
      cites: "",
      citedBy: "",
      rel: "",
      review: false,
      area: [],
      sdg: [],
      oa: false,
      type: [],
      wlang: [],
      itype: [],
      funder: [],
      mincite: null,
      abs: false,
      retracted: false,
      lang: "en",
    },
    setQuery: vi.fn(),
  }),
}));

vi.mock("@/lib/store", () => ({
  useKeywordExpansionStore: { getState: () => ({ ensureShortcuts: async () => {}, expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }) },
  useCurrentQuestionStore: () => ({ currentQuestion: "" }),
  useSearchHistoryStore: <T,>(selector: (state: unknown) => T) =>
    selector({
      searchHistory: searchHistoryRef.current,
      updateSearchResult: updateSearchResultMock,
    }),
  useResultsTranslationSettingsStore: <T,>(selector: (state: unknown) => T) =>
    selector({
      autoTranslateResults: false,
      targetLanguageOverride: null,
      setAutoTranslateResults: vi.fn(),
      setTargetLanguageOverride: vi.fn(),
      clearTargetLanguageOverride: vi.fn(),
      requestManualRun: vi.fn(),
    }),
}));

vi.mock("@/lib/toast", () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
  useAppToast: () => ({
    ai: { configRequired: vi.fn() },
    error: vi.fn(),
    validation: { failed: vi.fn() },
  }),
}));

vi.mock("@/lib/ai/client/router", () => ({
  useEnhanceSearchQuery: () => ({
    execute: vi.fn(),
    isConfigured: true,
  }),
}));

vi.mock("@/lib/keyword-validation", () => ({
  validateAndExpandKeywordsSilently: (query: string) => ({
    expandedQuery: query,
  }),
  validateAndExpandKeywords: (query: string) => ({
    isValid: true,
    expandedQuery: query,
    warnings: [],
  }),
}));

vi.mock("@/components/screening/screening-dialog", () => ({
  ScreeningDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" /> : null,
}));

vi.mock("@/components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Tooltip: Passthrough,
    TooltipContent: Passthrough,
    TooltipTrigger: ({
      children,
      asChild,
    }: {
      children: React.ReactNode;
      asChild?: boolean;
    }) => (asChild ? <>{children}</> : <button type="button">{children}</button>),
    TooltipHint: Passthrough,
  };
});

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

describe("<SearchCommandFooter> auth-gated limits", () => {
  beforeEach(() => {
    authReadinessRef.current = {
      phase: "anonymous",
      isBootstrapping: false,
      canRunProtectedQueries: false,
      retryUserSync: vi.fn(),
    };
    currentUserIdRef.current = null;
    searchHistoryRef.current = [];
    goToSignInMock.mockReset();
    pushMock.mockReset();
    startJobMock.mockReset();
    startJobMock.mockResolvedValue({ jobId: "job_for_current_account" });
    updateSearchResultMock.mockReset();
    useQueryMock.mockClear();
  });

  it("renders anonymous results pages without firing protected pull-limit queries", () => {
    render(
      <SearchCommandFooter
        totalCount={500}
        currentQuery="graph neural networks"
        isScreeningOpen={false}
        onScreeningToggle={vi.fn()}
        screeningPanelId="screening-panel"
        screeningQuestionCount={0}
        searchId="search_1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "startChat" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "startChat" }));
    expect(goToSignInMock).toHaveBeenCalledTimes(1);
  });

  it("shows Start Chat when the saved chat belongs to a different account", () => {
    authReadinessRef.current = {
      phase: "authenticated",
      isBootstrapping: false,
      canRunProtectedQueries: true,
      retryUserSync: vi.fn(),
    };
    currentUserIdRef.current = "acct_y";
    searchHistoryRef.current = [
      {
        id: "search_1",
        chatJobIdsByAccountId: { acct_x: "job_for_account_x" },
      },
    ];

    render(
      <SearchCommandFooter
        totalCount={500}
        currentQuery="graph neural networks"
        isScreeningOpen={false}
        onScreeningToggle={vi.fn()}
        screeningPanelId="screening-panel"
        screeningQuestionCount={0}
        searchId="search_1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "startChat" }),
    ).toHaveAttribute("data-chat-button-mode", "start");
    expect(screen.queryByRole("button", { name: "continueChat" })).toBeNull();
  });

  it("shows Continue Chat for the current account's saved chat", () => {
    authReadinessRef.current = {
      phase: "authenticated",
      isBootstrapping: false,
      canRunProtectedQueries: true,
      retryUserSync: vi.fn(),
    };
    currentUserIdRef.current = "acct_y";
    searchHistoryRef.current = [
      {
        id: "search_1",
        chatJobIdsByAccountId: {
          acct_x: "job_for_account_x",
          acct_y: "job_for_account_y",
        },
      },
    ];

    render(
      <SearchCommandFooter
        totalCount={500}
        currentQuery="graph neural networks"
        isScreeningOpen={false}
        onScreeningToggle={vi.fn()}
        screeningPanelId="screening-panel"
        screeningQuestionCount={0}
        searchId="search_1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "continueChat" }),
    ).toHaveAttribute("data-chat-button-mode", "continue");
    expect(screen.queryByRole("button", { name: "startChat" })).toBeNull();
  });

  it("stores a newly started chat under the current account without overwriting another account", async () => {
    authReadinessRef.current = {
      phase: "authenticated",
      isBootstrapping: false,
      canRunProtectedQueries: true,
      retryUserSync: vi.fn(),
    };
    currentUserIdRef.current = "acct_y";
    searchHistoryRef.current = [
      {
        id: "search_1",
        chatJobIdsByAccountId: { acct_x: "job_for_account_x" },
      },
    ];

    render(
      <SearchCommandFooter
        totalCount={500}
        currentQuery="graph neural networks"
        isScreeningOpen={false}
        onScreeningToggle={vi.fn()}
        screeningPanelId="screening-panel"
        screeningQuestionCount={0}
        searchId="search_1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "startChat" }));

    await waitFor(() => {
      expect(updateSearchResultMock).toHaveBeenCalledWith("search_1", {
        chatJobIdsByAccountId: {
          acct_x: "job_for_account_x",
          acct_y: "job_for_current_account",
        },
      });
    });
  });
});
