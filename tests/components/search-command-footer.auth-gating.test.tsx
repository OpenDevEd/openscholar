/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchCommandFooter } from "@/components/search-command-center/search-command-footer";

const {
  authReadinessRef,
  currentUserIdRef,
  goToSignInMock,
  pushMock,
  enhanceMock,
  ensureShortcutsMock,
  savedFieldRef,
  searchFieldRef,
  searchHistoryRef,
  setQueryMock,
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
    enhanceMock: vi.fn(),
    // Reads the shortcuts a query names before it's rewritten; an account's take a moment.
    ensureShortcutsMock: vi.fn(async () => {}),
    // The search's field as its saved state has it, which a switch in the sidebar changes at once.
    savedFieldRef: { current: "title_and_abstract" },
    searchFieldRef: { current: "title_and_abstract" },
    setQueryMock: vi.fn(),
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

vi.mock("@/components/icons", () => ({
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
      field: searchFieldRef.current,
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
      author: [],
      mincite: null,
      abs: false,
      retracted: false,
      lang: "en",
    },
    setQuery: setQueryMock,
  }),
}));

vi.mock("@/lib/store", () => ({
  useKeywordExpansionStore: { getState: () => ({ ensureShortcuts: ensureShortcutsMock, expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }) },
  useCurrentQuestionStore: () => ({ currentQuestion: "" }),
  useSearchHistoryStore: Object.assign(
    <T,>(selector: (state: unknown) => T) =>
      selector({
        searchHistory: searchHistoryRef.current,
        updateSearchResult: updateSearchResultMock,
      }),
    { getState: () => ({ getSearchResult: () => ({ field: savedFieldRef.current }) }) },
  ),
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
    execute: enhanceMock,
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
    searchFieldRef.current = "title_and_abstract";
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

// A question asked by meaning is searched as it is written: AI doesn't rewrite it broader or narrower.
describe("<SearchCommandFooter> with a question asked by meaning", () => {
  function showFooter(field: string, totalCount: number) {
    searchFieldRef.current = field;
    render(
      <SearchCommandFooter
        totalCount={totalCount}
        currentQuery="What helps teachers stay in rural schools?"
        isScreeningOpen={false}
        onScreeningToggle={vi.fn()}
        screeningPanelId="screening-panel"
        screeningQuestionCount={0}
        searchId="search_1"
      />,
    );
  }

  it("offers no broader query for a question asked by meaning", () => {
    showFooter("semantic", 3);
    expect(screen.queryByRole("button", { name: "makeBroader" })).not.toBeInTheDocument();
  });

  it("offers a broader query for keywords that find few works", () => {
    showFooter("title_and_abstract", 3);
    expect(screen.getByRole("button", { name: "makeBroader" })).toBeInTheDocument();
  });

  // Broadening takes seconds: keywords written for a keyword search aren't used once the
  // person has switched the search to a question by meaning meanwhile.
  for (const switched of [true, false]) {
    it(switched ? "drops a broader query once the search asks by meaning" : "uses a broader query while the search stays a keyword search", async () => {
      savedFieldRef.current = "title_and_abstract";
      setQueryMock.mockClear();
      let finish = () => {};
      enhanceMock.mockReset();
      enhanceMock.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ enhancedQuery: "rural OR remote", explanation: "" }); }));
      showFooter("title_and_abstract", 3);
      fireEvent.click(screen.getByRole("button", { name: "makeBroader" }));
      await waitFor(() => expect(enhanceMock).toHaveBeenCalled());
      if (switched) savedFieldRef.current = "semantic";
      await act(async () => finish());
      if (switched) expect(setQueryMock).not.toHaveBeenCalled();
      else expect(setQueryMock).toHaveBeenCalledWith("rural OR remote");
    });
  }

  it("drops a broader query once the search asks by meaning while its shortcuts load", async () => {
    savedFieldRef.current = "title_and_abstract";
    setQueryMock.mockClear();
    let shortcutsRead = () => {};
    ensureShortcutsMock.mockClear();
    ensureShortcutsMock.mockImplementationOnce(() => new Promise<void>((resolve) => { shortcutsRead = resolve; }));
    enhanceMock.mockReset();
    enhanceMock.mockResolvedValue({ enhancedQuery: "rural OR remote", explanation: "" });
    showFooter("title_and_abstract", 3);
    fireEvent.click(screen.getByRole("button", { name: "makeBroader" }));
    await waitFor(() => expect(ensureShortcutsMock).toHaveBeenCalled());
    savedFieldRef.current = "semantic";
    // The shortcuts arrive, the AI answers at once, and the handler runs to its end.
    await act(async () => {
      shortcutsRead();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(enhanceMock).toHaveBeenCalled();
    expect(setQueryMock).not.toHaveBeenCalled();
  });
});
