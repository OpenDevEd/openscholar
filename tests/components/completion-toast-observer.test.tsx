/**
 * @vitest-environment jsdom
 *
 * Behavior tests for <CompletionToastObserver>. Asserts on the toast
 * side-effect — not on component markup (it renders null).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const successMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => successMock(...args),
  },
}));

const useProtectedQueryMock = vi.fn();
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (...args: unknown[]) => useProtectedQueryMock(...args),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      queries: { costs: { getJobCost: "__stub_get_job_cost" } },
    },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) => {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
}));

import { CompletionToastObserver } from "@/components/extraction/completion-toast-observer";
import type { Id } from "@/convex/_generated/dataModel";

const fakeJobId = "job_xyz" as Id<"extractionJobs">;

function withCost(total: number) {
  useProtectedQueryMock.mockReturnValue({
    data: { total },
    settlement: "ready",
  });
}

describe("<CompletionToastObserver>", () => {
  beforeEach(() => {
    successMock.mockClear();
    useProtectedQueryMock.mockReset();
  });

  it("does not fire when a job is mounted already in completed status", () => {
    withCost(218);
    render(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );
    expect(successMock).not.toHaveBeenCalled();
  });

  it("fires exactly once on extracting → completed transition with credit count + paper count", () => {
    withCost(218);
    const { rerender } = render(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="extracting"
        processedPapers={47}
      />,
    );
    expect(successMock).not.toHaveBeenCalled();

    rerender(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );

    expect(successMock).toHaveBeenCalledTimes(1);
    const [title, opts] = successMock.mock.calls[0];
    expect(title).toBe("completionToastTitle");
    expect(opts.description).toContain("218");
    expect(opts.description).toContain("47");
  });

  it("does not double-fire on subsequent re-renders in completed state", () => {
    withCost(218);
    const { rerender } = render(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="extracting"
        processedPapers={47}
      />,
    );
    rerender(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );
    rerender(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );
    rerender(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  it("does not fire if transition happens but cost data is still loading", () => {
    useProtectedQueryMock.mockReturnValue({
      data: undefined,
      settlement: "query_loading",
    });
    const { rerender } = render(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="extracting"
        processedPapers={47}
      />,
    );
    rerender(
      <CompletionToastObserver
        jobId={fakeJobId}
        jobStatus="completed"
        processedPapers={47}
      />,
    );
    expect(successMock).not.toHaveBeenCalled();
  });
});
