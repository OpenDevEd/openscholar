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
        countJobFailures: "__stub_job_failures",
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

/** The job's failure counts, as the query returns them: papers that failed per code. */
function withFailures(paperErrors: Record<string, number>, answered: number, asked: number) {
  const summary = { asked, answered, retryable: 0, permanent: {}, paperErrors };
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
    const { container } = render(<MixedSuccessSummary jobId={fakeJobId} papersRead={11} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are zero failures (clean completed job)", () => {
    withFailures({}, 500, 500);
    const { container } = render(<MixedSuccessSummary jobId={fakeJobId} papersRead={11} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a region with the full data-* contract when there are failures", () => {
    withFailures({ rate_limit: 15, pdf_invalid: 8, context_too_long: 4 }, 473, 500);
    render(<MixedSuccessSummary jobId={fakeJobId} papersRead={11} />);
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
    withFailures({ rate_limit: 4, auth: 2, pdf_invalid: 1 }, 3, 10);
    render(<MixedSuccessSummary jobId={fakeJobId} papersRead={11} />);
    const rows = document.querySelectorAll("[data-failure-code]");
    expect(rows.length).toBe(3);
    expect(rows[0]).toHaveAttribute("data-failure-code", "rate_limit");
    expect(rows[1]).toHaveAttribute("data-failure-code", "auth");
    expect(rows[2]).toHaveAttribute("data-failure-code", "pdf_invalid");
  });

  it("data-retryable-total is zero when all failures are permanent", () => {
    withFailures({ pdf_invalid: 2, auth: 1 }, 7, 10);
    render(<MixedSuccessSummary jobId={fakeJobId} papersRead={11} />);
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("data-retryable-total", "0");
  });
});
