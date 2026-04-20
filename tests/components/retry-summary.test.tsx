/**
 * @vitest-environment jsdom
 *
 * Plan-05 — behavior tests for <RetrySummary>.
 *
 * Asserts on the data-retryable-count / data-permanent-count contract
 * (per project CLAUDE.md testing doctrine — never Tailwind utilities)
 * and on role=status for accessible announcement of the classification.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RetrySummary } from "@/components/extraction/retry-summary";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Drive the summary query output per-test. Single shared store so the
// dialog's checkBalance query also reads from here — tests typically
// don't care about the dialog's balance, just that it mounts.
const summaryStore = {
  data: undefined as
    | undefined
    | {
        retryableCount: number;
        permanentCount: number;
        permanentBreakdown: Record<string, number>;
      },
};
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => summaryStore,
}));

const retryMock = vi.fn();
vi.mock("convex/react", () => ({
  useMutation: () => retryMock,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    extraction: {
      queries: { retry: { getRetryableSummary: "getRetryableSummary" } },
      mutations: { retryFailedQuestions: "retryFailedQuestions" },
    },
    credits: {
      queries: { checkBalance: "checkBalance" },
    },
  },
}));

const jobId = "jobs:retry_summary_test" as never;

describe("<RetrySummary>", () => {
  beforeEach(() => {
    summaryStore.data = undefined;
    retryMock.mockReset();
  });

  it("renders nothing while the query is loading", () => {
    summaryStore.data = undefined;
    const { container } = render(<RetrySummary jobId={jobId} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there are zero failures and zero permanents", () => {
    summaryStore.data = {
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    };
    const { container } = render(<RetrySummary jobId={jobId} />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes data-retryable-count and data-permanent-count attributes", () => {
    summaryStore.data = {
      retryableCount: 3,
      permanentCount: 2,
      permanentBreakdown: { pdf_invalid: 1, moderation: 1 },
    };
    render(<RetrySummary jobId={jobId} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("data-retryable-count", "3");
    expect(banner).toHaveAttribute("data-permanent-count", "2");
  });

  it("shows the retry button when retryableCount > 0, with a count-aware label", () => {
    summaryStore.data = {
      retryableCount: 5,
      permanentCount: 0,
      permanentBreakdown: {},
    };
    render(<RetrySummary jobId={jobId} />);
    const btn = screen.getByRole("button", { name: /retryButton.*5/ });
    expect(btn).toHaveAttribute("data-action", "retry");
    expect(btn).not.toBeDisabled();
  });

  it("hides the retry button when retryableCount === 0 but permanents exist", () => {
    summaryStore.data = {
      retryableCount: 0,
      permanentCount: 2,
      permanentBreakdown: { pdf_invalid: 2 },
    };
    render(<RetrySummary jobId={jobId} />);
    expect(screen.queryByRole("button", { name: /retryButton/ })).toBeNull();
    // But the banner itself stays so the permanent-failures callout (B6)
    // has a container in which to render.
    expect(screen.getByRole("status")).toHaveAttribute(
      "data-permanent-count",
      "2",
    );
  });

  it("clicking retry opens the confirm dialog (does NOT call the mutation directly)", async () => {
    summaryStore.data = {
      retryableCount: 2,
      permanentCount: 0,
      permanentBreakdown: {},
    };
    retryMock.mockResolvedValue({ retryableCount: 2 });
    render(<RetrySummary jobId={jobId} />);
    fireEvent.click(screen.getByRole("button", { name: /retryButton/ }));
    // Dialog mounts on click.
    await waitFor(() =>
      expect(screen.getByRole("alertdialog")).toBeInTheDocument(),
    );
    // Mutation NOT invoked on the trigger — only on dialog confirm
    // (which is covered by retry-confirm-dialog tests).
    expect(retryMock).not.toHaveBeenCalled();
  });
});
