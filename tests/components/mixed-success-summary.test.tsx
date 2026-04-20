/**
 * @vitest-environment jsdom
 *
 * Plan-07 — behavior tests for <MixedSuccessSummary>.
 *
 * Asserts on role="region", aria-labelledby, and the data-* contract
 * (answered/total/failed/retryable + per-row data-failure-code). Never
 * asserts on Tailwind strings.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useProtectedQueryMock = vi.fn();

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (...args: unknown[]) => useProtectedQueryMock(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      queries: {
        mixedSuccessSummary: {
          getMixedSuccessSummary: "__stub_mixed_success",
        },
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

import { MixedSuccessSummary } from "@/components/extraction/mixed-success-summary";
import type { Id } from "@/convex/_generated/dataModel";

const fakeJobId = "job_abc" as Id<"extractionJobs">;

function withSummary(summary: {
  total: number;
  byCode: Array<{ code: string; count: number; retryable: boolean }>;
}) {
  useProtectedQueryMock.mockReturnValue({
    data: summary,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  });
}

function withLoading() {
  useProtectedQueryMock.mockReturnValue({
    data: undefined,
    phase: "authenticated",
    isDeferred: false,
    isReady: false,
    isAnonymous: false,
    settlement: "query_loading",
  });
}

describe("<MixedSuccessSummary>", () => {
  it("renders nothing while the summary query is loading", () => {
    withLoading();
    const { container } = render(
      <MixedSuccessSummary
        jobId={fakeJobId}
        totalQuestions={500}
        answeredTotal={473}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are zero failures (clean completed job)", () => {
    withSummary({ total: 0, byCode: [] });
    const { container } = render(
      <MixedSuccessSummary
        jobId={fakeJobId}
        totalQuestions={500}
        answeredTotal={500}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a region with the full data-* contract when there are failures", () => {
    withSummary({
      total: 27,
      byCode: [
        { code: "rate_limit", count: 15, retryable: true },
        { code: "pdf_invalid", count: 8, retryable: false },
        { code: "context_too_long", count: 4, retryable: false },
      ],
    });
    render(
      <MixedSuccessSummary
        jobId={fakeJobId}
        totalQuestions={500}
        answeredTotal={473}
      />,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-mixed-success-summary");
    expect(region).toHaveAttribute("data-answered-total", "473");
    expect(region).toHaveAttribute("data-total-questions", "500");
    expect(region).toHaveAttribute("data-failed-total", "27");
    // 15 (rate_limit) is the only retryable bucket here.
    expect(region).toHaveAttribute("data-retryable-total", "15");
    // aria-labelledby points to an element with the title.
    const labelId = region.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const label = document.getElementById(labelId as string);
    expect(label).not.toBeNull();
  });

  it("emits one data-failure-code row per breakdown entry, preserving query order", () => {
    withSummary({
      total: 7,
      byCode: [
        { code: "rate_limit", count: 4, retryable: true },
        { code: "auth", count: 2, retryable: false },
        { code: "pdf_invalid", count: 1, retryable: false },
      ],
    });
    render(
      <MixedSuccessSummary
        jobId={fakeJobId}
        totalQuestions={10}
        answeredTotal={3}
      />,
    );
    const rows = document.querySelectorAll("[data-failure-code]");
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveAttribute("data-failure-code", "rate_limit");
    expect(rows[1]).toHaveAttribute("data-failure-code", "auth");
    expect(rows[2]).toHaveAttribute("data-failure-code", "pdf_invalid");
  });

  it("data-retryable-total is zero when all failures are permanent", () => {
    withSummary({
      total: 3,
      byCode: [
        { code: "pdf_invalid", count: 2, retryable: false },
        { code: "auth", count: 1, retryable: false },
      ],
    });
    render(
      <MixedSuccessSummary
        jobId={fakeJobId}
        totalQuestions={10}
        answeredTotal={7}
      />,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-retryable-total", "0");
  });
});
