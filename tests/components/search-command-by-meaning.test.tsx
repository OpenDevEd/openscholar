/**
 * @vitest-environment jsdom
 *
 * The search command center with a question asked by meaning. The question is
 * searched as it is written, so the AI that writes, rewrites and translates
 * keyword queries is off, and a note says why.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { searchRef, noop, questionStore, historyStore } = vi.hoisted(() => {
  const noop = () => {};
  return {
    searchRef: { current: { field: "semantic", q: "" } },
    noop,
    questionStore: { currentQuestion: "What helps teachers stay in rural schools?", setCurrentQuestion: noop },
    historyStore: { addQuestionToHistory: noop, getSearchResult: () => undefined },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/search", () => {
  const search = () => ({
    params: { ...searchRef.current, lang: "fr" },
    error: null,
    setQuery: vi.fn(),
    setLanguage: vi.fn(),
  });
  return { useSearch: search, useSearchOptional: search };
});
vi.mock("@/lib/store", () => ({
  useCurrentQuestionStore: () => questionStore,
  useSearchHistoryStore: () => historyStore,
  useAIConfigStore: () => ({ apiKeyMode: "platform" }),
  useCurrentQueryStore: () => ({ setCurrentQuery: noop }),
  useKeywordExpansionDialogStore: (select: (state: { setSuggestedQuery: () => void }) => unknown) => select({ setSuggestedQuery: noop }),
  useKeywordExpansionStore: { getState: () => ({ ensureShortcuts: async () => {}, expandQuery: (query: string) => ({ expandedQuery: query, warnings: [] }) }) },
}));
vi.mock("@/lib/hooks", () => ({
  useEffectiveSearchId: () => "search_1",
  useQueryHistory: () => ({ historyIndex: 0, historyLength: 1, canGoPrevious: false, canGoNext: false, goToPrevious: noop, goToNext: noop }),
}));
vi.mock("@/lib/toast", () => ({
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
  useAppToast: () => ({ ai: { configRequired: vi.fn(), failed: vi.fn() }, error: vi.fn(), validation: { failed: vi.fn() } }),
}));
vi.mock("@/lib/ai/client/router", () => ({
  useEnhanceSearchQuery: () => ({ execute: vi.fn(), isConfigured: true }),
  useTranslateQuery: () => ({ execute: vi.fn(), isConfigured: true }),
}));
vi.mock("@/lib/research/reads", () => ({ useQueryShortcuts: noop }));
vi.mock("@/components/ai/ai-setup-gate", () => ({ AISetupGate: () => null }));
vi.mock("@/components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { Tooltip: Passthrough, TooltipContent: Passthrough, TooltipTrigger: Passthrough, TooltipHint: Passthrough, TooltipProvider: Passthrough };
});

import { SearchMode } from "@/components/search-command-center/search-mode";
import { AdjustMode } from "@/components/search-command-center/adjust-mode";

const QUESTION = "What helps teachers stay in rural schools?";

describe("search mode", () => {
  it("turns off the AI that writes and translates keywords for a question asked by meaning", () => {
    searchRef.current = { field: "semantic", q: QUESTION };
    render(<SearchMode />);
    expect(screen.getByRole("button", { name: "askAI" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "translate" })).toBeDisabled();
    expect(screen.getByText("byMeaningNoAI")).toBeInTheDocument();
  });

  it("keeps the AI for a keyword search", () => {
    searchRef.current = { field: "title_and_abstract", q: "rural teachers" };
    render(<SearchMode />);
    expect(screen.getByRole("button", { name: "askAI" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "translate" })).toBeEnabled();
    expect(screen.queryByText("byMeaningNoAI")).not.toBeInTheDocument();
  });
});

describe("adjust mode", () => {
  it("turns off the AI that rewrites keywords for a question asked by meaning", () => {
    searchRef.current = { field: "semantic", q: QUESTION };
    render(<AdjustMode searchId="search_1" />);
    expect(screen.getByPlaceholderText("searchCommand.placeholder.enhance")).toBeDisabled();
    expect(screen.getByText("searchCommand.byMeaningNoAI")).toBeInTheDocument();
  });

  it("keeps the AI for a keyword search", () => {
    searchRef.current = { field: "title_and_abstract", q: "rural teachers" };
    render(<AdjustMode searchId="search_1" />);
    expect(screen.getByPlaceholderText("searchCommand.placeholder.enhance")).toBeEnabled();
    expect(screen.queryByText("searchCommand.byMeaningNoAI")).not.toBeInTheDocument();
  });
});
