/**
 * @vitest-environment jsdom
 *
 * Behavior tests for <CostBadge>. Asserts on role="status",
 * data-credits-total, and data-breakdown-bucket — stable contracts per
 * project CLAUDE.md testing doctrine (no asserting on CSS utilities).
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
        costs: { getJobCost: "__stub_get_job_cost" },
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

vi.mock("@/components/ui/tooltip", () => {
  const Tooltip = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const TooltipTrigger = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const TooltipContent = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  );
  return { Tooltip, TooltipTrigger, TooltipContent };
});

import { CostBadge } from "@/components/extraction/cost-badge";
import type { Id } from "@/convex/_generated/dataModel";

const fakeJobId = "job_abc" as Id<"extractionJobs">;

function withCostData(data: {
  total: number;
  breakdown: {
    extraction_llm: number;
    embedding: number;
    screening: number;
    chat: number;
    other: number;
  };
}) {
  useProtectedQueryMock.mockReturnValue({
    data,
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

describe("<CostBadge>", () => {
  it("renders a skeleton in query_loading state with data-credits-total=0 and aria-busy", () => {
    withLoadingState();
    render(<CostBadge jobId={fakeJobId} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-credits-total", "0");
    expect(el).toHaveAttribute("aria-busy", "true");
  });

  it("renders the total with role=status and data-credits-total matching the sum", () => {
    withCostData({
      total: 218,
      breakdown: {
        extraction_llm: 68,
        embedding: 150,
        screening: 0,
        chat: 0,
        other: 0,
      },
    });
    render(<CostBadge jobId={fakeJobId} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-credits-total", "218");
    // The formatted text shows the amount somewhere.
    expect(el.textContent).toContain("218");
  });

  it("breakdown rows render only for non-zero buckets and are tagged by data-breakdown-bucket", () => {
    withCostData({
      total: 218,
      breakdown: {
        extraction_llm: 68,
        embedding: 150,
        screening: 0,
        chat: 0,
        other: 0,
      },
    });
    render(<CostBadge jobId={fakeJobId} />);

    const tooltip = screen.getByTestId("tooltip-content");
    const buckets = tooltip.querySelectorAll("[data-breakdown-bucket]");
    const bucketIds = Array.from(buckets).map((b) =>
      b.getAttribute("data-breakdown-bucket"),
    );

    expect(bucketIds).toContain("extraction_llm");
    expect(bucketIds).toContain("embedding");
    expect(bucketIds).not.toContain("screening");
    expect(bucketIds).not.toContain("chat");
    expect(bucketIds).not.toContain("other");
  });

  it("renders a navigation link with aria-label when href is provided", () => {
    withCostData({
      total: 42,
      breakdown: {
        extraction_llm: 42,
        embedding: 0,
        screening: 0,
        chat: 0,
        other: 0,
      },
    });
    render(
      <CostBadge
        jobId={fakeJobId}
        href="/settings/billing?jobId=job_abc"
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/settings/billing?jobId=job_abc");
    expect(link).toHaveAttribute("data-credits-total", "42");
    expect(link).toHaveAttribute("data-transactions-link", "view");
    // ICU payload passes through the translation mock verbatim so the
    // aria-label still carries the amount argument — the real locale
    // bundle is exercised in integration tests.
    expect(link.getAttribute("aria-label")).toContain("42");
  });

  it("renders a non-link span when href is omitted (default)", () => {
    withCostData({
      total: 7,
      breakdown: {
        extraction_llm: 7,
        embedding: 0,
        screening: 0,
        chat: 0,
        other: 0,
      },
    });
    render(<CostBadge jobId={fakeJobId} />);
    expect(screen.queryByRole("link")).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-credits-total", "7");
    expect(status).not.toHaveAttribute("href");
  });

  it("zero-total job renders data-credits-total=0 without a breakdown", () => {
    withCostData({
      total: 0,
      breakdown: {
        extraction_llm: 0,
        embedding: 0,
        screening: 0,
        chat: 0,
        other: 0,
      },
    });
    render(<CostBadge jobId={fakeJobId} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("data-credits-total", "0");
    const tooltip = screen.getByTestId("tooltip-content");
    expect(tooltip.querySelectorAll("[data-breakdown-bucket]").length).toBe(0);
  });
});
