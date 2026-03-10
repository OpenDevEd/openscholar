import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsOverview } from "../components/extraction/insights-overview";
import type { Id } from "../convex/_generated/dataModel";

// Mock next-intl — return key as value (avoids NextIntlClientProvider setup)
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock SummaryCards to avoid deep rendering (Tooltip, card-thresholds, confidence-badge)
// The test validates InsightsOverview wiring, not SummaryCards internals
vi.mock("../components/extraction/summary-cards", () => ({
  SummaryCards: ({ answeredRate, groundedRate, bestEffortRate, noContentCount }: {
    answeredRate: number;
    groundedRate: number;
    bestEffortRate: number;
    noContentCount: number;
    [key: string]: unknown;
  }) => (
    <div data-testid="summary-cards-mock">
      <span>{Math.round(answeredRate * 100)}%</span>
      <span>{Math.round(groundedRate * 100)}%</span>
      <span>{Math.round(bestEffortRate * 100)}%</span>
      <span>{noContentCount}</span>
    </div>
  ),
}));

const mockInsights = {
  status: "ok" as const,
  summary: {
    answeredRate: 0.75,
    groundedRate: 0.6,
    bestEffortRate: 0.15,
    noContentCount: 3,
    averageConfidence: 0.82,
    abstractOnlyCount: 2,
  },
  questions: [
    {
      key: "sample_size",
      question: "What is the sample size?",
      answered: 7,
      total: 10,
      grounded: 5,
      avgConfidence: 0.82,
    },
    {
      key: "methods",
      question: "What methods were used?",
      answered: 9,
      total: 10,
      grounded: 8,
      avgConfidence: 0.91,
    },
  ],
  diagnostics: { noContentPapers: [] },
};

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => ({ data: mockInsights, isDeferred: false }),
}));

const mockJobId = "mock-job-id" as unknown as Id<"extractionJobs">;

describe("InsightsOverview component", () => {
  it("renders null when enabled=false", () => {
    const { container } = render(
      <InsightsOverview
        jobId={mockJobId}
        onSelectQuestion={() => {}}
        enabled={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 4 summary metric sections", () => {
    const { container } = render(
      <InsightsOverview
        jobId={mockJobId}
        onSelectQuestion={() => {}}
        enabled={true}
      />
    );
    // Grid of cards: answered, grounded, bestEffort, noContent
    // Look for percentage text matching the mock data
    expect(container.textContent).toContain("75%"); // answeredRate
    expect(container.textContent).toContain("60%"); // groundedRate
    expect(container.textContent).toContain("15%"); // bestEffortRate
    expect(container.textContent).toContain("3"); // noContentCount
  });

  it("renders question list with one button per question", () => {
    render(
      <InsightsOverview
        jobId={mockJobId}
        onSelectQuestion={() => {}}
        enabled={true}
      />
    );
    // Each question is rendered as a <button>
    const buttons = screen.getAllByRole("button");
    // At least 2 question buttons (may be more if rerun button present)
    const questionButtons = buttons.filter(
      (btn) =>
        btn.textContent?.includes("sample size") ||
        btn.textContent?.includes("methods")
    );
    expect(questionButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onSelectQuestion with the question key when a question button is clicked", async () => {
    const onSelect = vi.fn();
    render(
      <InsightsOverview
        jobId={mockJobId}
        onSelectQuestion={onSelect}
        enabled={true}
      />
    );
    const sampleSizeBtn = screen
      .getByText(/sample size/i, { selector: "button *" })
      ?.closest("button");
    sampleSizeBtn?.click();
    expect(onSelect).toHaveBeenCalledWith("sample_size");
  });
});
