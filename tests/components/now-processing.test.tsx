/**
 * @vitest-environment jsdom
 *
 * Plan-07 — behavior tests for <NowProcessing>.
 *
 * Asserts on role, aria-live, aria-atomic, and data-now-processing-paper
 * (the semantic contract). Never asserts on CSS classes, per project
 * testing doctrine.
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
        nowProcessing: { getNowProcessing: "__stub_get_now_processing" },
      },
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

import { NowProcessing } from "@/components/extraction/now-processing";
import type { Id } from "@/convex/_generated/dataModel";

const fakeJobId = "job_abc" as Id<"extractionJobs">;
const fakePaperId = "paper_xyz" as Id<"extractionPapers">;

function withInFlightPaper(paper: {
  paperId: Id<"extractionPapers">;
  paperTitle: string;
  startedAt?: number;
}) {
  useProtectedQueryMock.mockReturnValue({
    data: paper,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  });
}

function withNoInFlight() {
  useProtectedQueryMock.mockReturnValue({
    data: null,
    phase: "authenticated",
    isDeferred: false,
    isReady: true,
    isAnonymous: false,
    settlement: "ready",
  });
}

function withLoadingState() {
  useProtectedQueryMock.mockReturnValue({
    data: undefined,
    phase: "authenticated",
    isDeferred: false,
    isReady: false,
    isAnonymous: false,
    settlement: "query_loading",
  });
}

describe("<NowProcessing>", () => {
  it("renders nothing while the query is loading", () => {
    withLoadingState();
    const { container } = render(<NowProcessing jobId={fakeJobId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no paper is in-flight", () => {
    withNoInFlight();
    const { container } = render(<NowProcessing jobId={fakeJobId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the live banner with the expected a11y + data contract", () => {
    withInFlightPaper({
      paperId: fakePaperId,
      paperTitle: "Attention is all you need",
      startedAt: Date.now(),
    });
    render(<NowProcessing jobId={fakeJobId} />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-atomic", "true");
    expect(banner).toHaveAttribute(
      "data-now-processing-paper",
      "Attention is all you need",
    );
    expect(banner).toHaveAttribute("data-paper-id", fakePaperId);
    // Paper title is surfaced in the visible banner text.
    expect(banner).toHaveTextContent("Attention is all you need");
  });

  it("updates the data-now-processing-paper attribute when the in-flight paper changes", () => {
    withInFlightPaper({
      paperId: fakePaperId,
      paperTitle: "First Paper",
    });
    const { rerender } = render(<NowProcessing jobId={fakeJobId} />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-now-processing-paper",
      "First Paper",
    );

    withInFlightPaper({
      paperId: "paper_next" as Id<"extractionPapers">,
      paperTitle: "Second Paper",
    });
    rerender(<NowProcessing jobId={fakeJobId} />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-now-processing-paper",
      "Second Paper",
    );
  });
});
