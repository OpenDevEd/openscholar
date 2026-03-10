import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsQuestionPanel } from "../components/extraction/insights-question-panel";
import type { Id } from "../convex/_generated/dataModel";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock next-intl — return key as value
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock BarVisualization to prevent dynamic import resolution in jsdom
// The mock renders a testable div with the answer count
vi.mock("../components/extraction/bar-visualization", () => ({
  BarVisualization: ({ answers }: { answers: unknown[] }) => (
    <div
      data-testid="bar-visualization-mock"
      data-answer-count={answers.length}
    />
  ),
}));

// ─── Mock data helpers ────────────────────────────────────────────────────────

const mockJobId = "mock-job-id" as unknown as Id<"extractionJobs">;

const baseInsights = {
  status: "ok" as const,
  question: { question: "What is the sample size?", type: "string" },
  total: 10,
  answered: 7,
  grounded: 5,
  avgConfidence: 0.82,
  avgEffectiveConfidence: 0.75,
  insightMode: "string" as const,
  confidenceBuckets: { high: 4, medium: 2, low: 1, unknown: 3 },
  citationStatusMix: {
    grounded: 5,
    best_effort: 2,
    insufficient_evidence: 2,
    extraction_error: 1,
  },
  rawAnswerDistribution: [
    {
      normalized: "273 studies",
      display: "273 studies",
      count: 5,
      citationStatusMix: {
        grounded: 4,
        best_effort: 1,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
    {
      normalized: "250 studies",
      display: "250 studies",
      count: 2,
      citationStatusMix: {
        grounded: 1,
        best_effort: 1,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
  ],
  topAnswers: [],
  entityDistribution: [],
};

const baseDisagreements = {
  status: "ok" as const,
  viewMode: "disagreement" as const,
  clusters: [],
  suppressedSingletonCount: 0,
};

// ─── Setup query mock ─────────────────────────────────────────────────────────

function mockProtectedQuery(
  insights: typeof baseInsights | null = baseInsights,
  disagreements: typeof baseDisagreements | null = baseDisagreements
) {
  vi.mock("@/lib/auth/use-auth-query", () => ({
    useProtectedQuery: vi.fn().mockImplementation(
      (_query: unknown, args: unknown) => {
        // Determine which query is being called by looking at args
        if (args === "skip") return { data: undefined, isDeferred: false };
        // Return appropriate mock based on type
        return { data: insights ?? disagreements, isDeferred: false };
      }
    ),
  }));
}

// Mock DisagreementList to keep tests focused
vi.mock("../components/extraction/disagreement-list", () => ({
  DisagreementList: () => <div data-testid="disagreement-list-mock" />,
}));

// Use separate mock per query type via call count
vi.mock("@/lib/auth/use-auth-query", () => {
  let callCount = 0;
  return {
    useProtectedQuery: vi.fn().mockImplementation((_query: unknown, args: unknown) => {
      if (args === "skip") return { data: undefined, isDeferred: false };
      callCount++;
      // First call = questionInsights, second = disagreementQuery
      if (callCount % 2 === 1) {
        return { data: baseInsights, isDeferred: false };
      } else {
        return { data: baseDisagreements, isDeferred: false };
      }
    }),
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InsightsQuestionPanel — BarVisualization wiring", () => {
  it("renders BarVisualization for rawAnswerDistribution when items exist", () => {
    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="sample_size"
        enabled={true}
      />
    );

    const barMocks = screen.getAllByTestId("bar-visualization-mock");
    expect(barMocks.length).toBeGreaterThanOrEqual(1);
  });

  it("BarVisualization receives correct answer count for rawAnswerDistribution", () => {
    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="sample_size"
        enabled={true}
      />
    );

    // rawAnswerDistribution has 2 items
    const barMocks = screen.getAllByTestId("bar-visualization-mock");
    const answerCounts = barMocks.map((el) =>
      Number(el.getAttribute("data-answer-count"))
    );
    expect(answerCounts.some((c) => c === 2)).toBe(true);
  });

  it("renders null when enabled=false", () => {
    const { container } = render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="sample_size"
        enabled={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders select-question message when questionKey is undefined", () => {
    const { container } = render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey={undefined}
        enabled={true}
      />
    );
    // Component returns early with a message
    expect(container.textContent).toContain("selectQuestionToInspect");
  });
});
