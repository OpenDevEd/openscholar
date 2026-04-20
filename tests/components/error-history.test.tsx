/**
 * @vitest-environment jsdom
 *
 * Plan-07 — behavior tests for <ErrorHistory>.
 *
 * Asserts on data-error-code, data-attempt-number, visible text,
 * role="region" (from Radix AccordionContent), and the ordering pinned
 * by the query (newest-first). Never asserts on Tailwind strings.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Radix Accordion keeps content unmounted when closed, so tests that
 * need to inspect rows must first open the panel. Helper clicks the
 * trigger for the accordion item we render.
 */
function openHistoryPanel() {
  // The button is the AccordionTrigger; there's only one in this
  // component so role=button matches it unambiguously.
  const trigger = screen.getByRole("button", {
    name: /triggerLabel/i,
  });
  fireEvent.click(trigger);
}

const useProtectedPaginatedQueryMock = vi.fn();

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedPaginatedQuery: (...args: unknown[]) =>
    useProtectedPaginatedQueryMock(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      queries: {
        errorHistory: { listPaperErrors: "__stub_list_paper_errors" },
      },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const full = `${namespace}.${key}`;
      if (params === undefined) return full;
      return `${full}:${JSON.stringify(params)}`;
    },
}));

import { ErrorHistory } from "@/components/extraction/error-history";
import type { Id } from "@/convex/_generated/dataModel";

const fakePaperId = "paper_xyz" as Id<"extractionPapers">;

function withResults(
  results: Array<{
    _id: Id<"extractionPaperErrors">;
    attempt: number;
    at: number;
    code: string;
    message: string;
  }>,
  opts: { status?: "CanLoadMore" | "Exhausted" | "LoadingMore" } = {},
) {
  useProtectedPaginatedQueryMock.mockReturnValue({
    results,
    status: opts.status ?? "Exhausted",
    isLoading: false,
    loadMore: vi.fn(),
    isInitialLoading: false,
    hasLoadedFirstPage: true,
    isSettled: true,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  });
}

function withLoading() {
  useProtectedPaginatedQueryMock.mockReturnValue({
    results: [],
    status: "LoadingFirstPage",
    isLoading: true,
    loadMore: vi.fn(),
    isInitialLoading: true,
    hasLoadedFirstPage: false,
    isSettled: false,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "query_loading",
  });
}

function withEmpty() {
  useProtectedPaginatedQueryMock.mockReturnValue({
    results: [],
    status: "Exhausted",
    isLoading: false,
    loadMore: vi.fn(),
    isInitialLoading: false,
    hasLoadedFirstPage: true,
    isSettled: true,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  });
}

describe("<ErrorHistory>", () => {
  it("renders nothing while the first page is loading", () => {
    withLoading();
    const { container } = render(<ErrorHistory paperId={fakePaperId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the paper has no error rows", () => {
    withEmpty();
    const { container } = render(<ErrorHistory paperId={fakePaperId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per error, each carrying data-error-code and data-attempt-number", () => {
    withResults([
      {
        _id: "err_3" as Id<"extractionPaperErrors">,
        attempt: 3,
        at: Date.parse("2026-04-19T14:32:00Z"),
        code: "rate_limit",
        message: "Upstream capacity exhausted",
      },
      {
        _id: "err_2" as Id<"extractionPaperErrors">,
        attempt: 2,
        at: Date.parse("2026-04-19T14:28:00Z"),
        code: "rate_limit",
        message: "Upstream capacity exhausted",
      },
      {
        _id: "err_1" as Id<"extractionPaperErrors">,
        attempt: 1,
        at: Date.parse("2026-04-19T14:27:00Z"),
        code: "network",
        message: "fetch failed",
      },
    ]);

    render(<ErrorHistory paperId={fakePaperId} />);
    openHistoryPanel();

    const rows = document.querySelectorAll("[data-attempt-number]");
    expect(rows.length).toBe(3);

    // Order matches the mocked response (newest-first from the query).
    expect(rows[0]).toHaveAttribute("data-attempt-number", "3");
    expect(rows[0]).toHaveAttribute("data-error-code", "rate_limit");
    expect(rows[1]).toHaveAttribute("data-attempt-number", "2");
    expect(rows[1]).toHaveAttribute("data-error-code", "rate_limit");
    expect(rows[2]).toHaveAttribute("data-attempt-number", "1");
    expect(rows[2]).toHaveAttribute("data-error-code", "network");
  });

  it("exposes the error-history region via data-error-history on the accordion item", () => {
    withResults([
      {
        _id: "err_1" as Id<"extractionPaperErrors">,
        attempt: 1,
        at: Date.now(),
        code: "network",
        message: "fetch failed",
      },
    ]);
    render(<ErrorHistory paperId={fakePaperId} />);
    const wrapper = document.querySelector("[data-error-history]");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("data-paper-id", fakePaperId);
  });

  it("shows a Load More action when status is CanLoadMore", () => {
    withResults(
      [
        {
          _id: "err_1" as Id<"extractionPaperErrors">,
          attempt: 1,
          at: Date.now(),
          code: "network",
          message: "fetch failed",
        },
      ],
      { status: "CanLoadMore" },
    );
    render(<ErrorHistory paperId={fakePaperId} />);
    openHistoryPanel();
    const loadMoreBtn = screen.getByRole("button", { name: /loadMore/i });
    expect(loadMoreBtn).toHaveAttribute("data-action", "load-more");
  });

  it("hides the Load More action once the query is Exhausted", () => {
    withResults(
      [
        {
          _id: "err_1" as Id<"extractionPaperErrors">,
          attempt: 1,
          at: Date.now(),
          code: "network",
          message: "fetch failed",
        },
      ],
      { status: "Exhausted" },
    );
    render(<ErrorHistory paperId={fakePaperId} />);
    expect(
      document.querySelector('[data-action="load-more"]'),
    ).toBeNull();
  });
});
