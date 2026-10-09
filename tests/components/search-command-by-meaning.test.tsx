/**
 * @vitest-environment jsdom
 *
 * The search command center with a question asked by meaning. The question is
 * searched as it is written, so the AI that writes, rewrites and translates
 * keyword queries is off, and a note says why.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { searchRef, savedField, setQuery, enhance, translate, noop, questionStore, historyStore } = vi.hoisted(() => {
  const noop = () => {};
  // The search's field as its saved state has it, which a switch in the sidebar changes at once.
  const savedField = { current: "title_and_abstract" };
  return {
    searchRef: { current: { field: "semantic", q: "" } },
    savedField,
    setQuery: vi.fn(),
    enhance: vi.fn(),
    translate: vi.fn(),
    noop,
    questionStore: { currentQuestion: "What helps teachers stay in rural schools?", setCurrentQuestion: noop },
    historyStore: { addQuestionToHistory: noop, getSearchResult: () => ({ field: savedField.current }) },
  };
});

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("@/lib/search", () => {
  const search = () => ({
    searchId: "search_1",
    params: { ...searchRef.current, lang: "fr" },
    error: null,
    setQuery,
    setLanguage: vi.fn(),
  });
  return { useSearch: search, useSearchOptional: search };
});
vi.mock("@/lib/store", () => ({
  useCurrentQuestionStore: () => questionStore,
  useSearchHistoryStore: Object.assign(() => historyStore, { getState: () => historyStore }),
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
  useEnhanceSearchQuery: () => ({ execute: enhance, isConfigured: true }),
  useTranslateQuery: () => ({ execute: translate, isConfigured: true }),
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

// An AI rewrite takes seconds. One written for keywords isn't used once the person has
// switched the search to a question by meaning meanwhile: it would be asked as the question.
describe("an AI rewrite that comes back after the search changed kind", () => {
  beforeEach(() => {
    searchRef.current = { field: "title_and_abstract", q: "rural teachers" };
    savedField.current = "title_and_abstract";
    setQuery.mockClear();
  });

  /** Makes the AI call answer only when the returned function is called. */
  function answerLater(call: Mock, answer: unknown) {
    let finish = () => {};
    call.mockReset();
    call.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(answer); }));
    return () => act(async () => finish());
  }

  const rewrites = [
    { name: "Ask AI", call: enhance, answer: { enhancedQuery: "rural AND teachers", explanation: "" }, start: () => {
      render(<SearchMode />);
      fireEvent.click(screen.getByRole("button", { name: "askAI" }));
    } },
    { name: "translate", call: translate, answer: { translatedQuery: "rural AND teachers" }, start: () => {
      render(<SearchMode />);
      fireEvent.click(screen.getByRole("button", { name: "translate" }));
    } },
    { name: "Enhance with AI", call: enhance, answer: { enhancedQuery: "rural AND teachers", explanation: "" }, start: () => {
      render(<AdjustMode searchId="search_1" />);
      fireEvent.change(screen.getByPlaceholderText("searchCommand.placeholder.enhance"), { target: { value: "only trials" } });
      fireEvent.click(screen.getByRole("button", { name: "searchCommand.enhance" }));
    } },
  ];

  for (const rewrite of rewrites) {
    it(`drops ${rewrite.name}'s keywords once the search asks by meaning`, async () => {
      const finish = answerLater(rewrite.call, rewrite.answer);
      rewrite.start();
      await waitFor(() => expect(rewrite.call).toHaveBeenCalled());
      savedField.current = "semantic";
      await finish();
      expect(setQuery).not.toHaveBeenCalled();
    });

    it(`uses ${rewrite.name}'s keywords while the search stays a keyword search`, async () => {
      const finish = answerLater(rewrite.call, rewrite.answer);
      rewrite.start();
      await waitFor(() => expect(rewrite.call).toHaveBeenCalled());
      await finish();
      expect(setQuery).toHaveBeenCalledWith("rural AND teachers");
    });
  }
});
