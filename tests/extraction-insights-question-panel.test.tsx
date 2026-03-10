import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsQuestionPanel } from "../components/extraction/insights-question-panel";
import type { Id } from "../convex/_generated/dataModel";
import * as authQuery from "@/lib/auth/use-auth-query";

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

// Mock GroupedAnswerRow (added in plan 03) — renders label with group count
vi.mock("../components/extraction/grouped-answer-row", () => ({
  GroupedAnswerRow: ({ group }: { group: { groupRepresentative: string; variants: unknown[] } }) => (
    <div
      data-testid="grouped-answer-row-mock"
      data-representative={group.groupRepresentative}
      data-variant-count={group.variants.length}
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

// Boolean question with 3 synonym variants: "yes", "true", "positive"
// groupAnswersBySynonym should collapse these into 1 group
const booleanInsights = {
  ...baseInsights,
  insightMode: "string" as const,
  rawAnswerDistribution: [
    {
      normalized: "yes",
      display: "Yes",
      count: 10,
      citationStatusMix: {
        grounded: 8,
        best_effort: 2,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
    {
      normalized: "true",
      display: "True",
      count: 4,
      citationStatusMix: {
        grounded: 3,
        best_effort: 1,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
    {
      normalized: "positive",
      display: "Positive",
      count: 2,
      citationStatusMix: {
        grounded: 2,
        best_effort: 0,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
  ],
  entityDistribution: [],
};

// Array mode question with 3 entities — entityDistribution should NOT be grouped
const entityInsights = {
  ...baseInsights,
  insightMode: "array" as const,
  rawAnswerDistribution: [],
  entityDistribution: [
    { entity: "Entity A", count: 5, groundedRate: 0.8 },
    { entity: "Entity B", count: 3, groundedRate: 0.6 },
    { entity: "Entity C", count: 1, groundedRate: 0.4 },
  ],
};

// ─── Mock DisagreementList to keep tests focused ───────────────────────────

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

// ─── Helper: configure query mock to serve specific insights data ──────────────

function setInsightsMock(insightsData: typeof baseInsights) {
  let callCount = 0;
  vi.mocked(authQuery.useProtectedQuery).mockImplementation(
    (_query: unknown, args: unknown) => {
      if (args === "skip") return { data: undefined, isDeferred: false };
      callCount++;
      // Odd calls = questionInsights, even calls = disagreements
      if (callCount % 2 === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { data: insightsData as any, isDeferred: false };
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { data: baseDisagreements as any, isDeferred: false };
      }
    }
  );
}

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

    // rawAnswerDistribution has 2 items — no synonyms, so grouping leaves 2 groups
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

describe("InsightsQuestionPanel — Grouping wiring (87-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BarVisualization receives 1 grouped item when rawAnswerDistribution has 3 boolean synonym variants", () => {
    setInsightsMock(booleanInsights);

    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="boolean_q"
        enabled={true}
      />
    );

    // 3 raw items (yes, true, positive) should be grouped into 1 "yes" group
    const barMocks = screen.getAllByTestId("bar-visualization-mock");
    const answerCounts = barMocks.map((el) =>
      Number(el.getAttribute("data-answer-count"))
    );
    // The raw distribution section should show 1 grouped item, not 3
    expect(answerCounts.some((c) => c === 1)).toBe(true);
  });

  it("GroupedAnswerRow renders for each grouped answer in the distribution section", () => {
    setInsightsMock(booleanInsights);

    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="boolean_q"
        enabled={true}
      />
    );

    // 3 boolean synonyms merge into 1 group — 1 GroupedAnswerRow should render
    const groupedRows = screen.getAllByTestId("grouped-answer-row-mock");
    expect(groupedRows.length).toBe(1);
    // Representative is "Yes" (highest count variant)
    expect(groupedRows[0].getAttribute("data-representative")).toBe("Yes");
    // 3 variants in the group
    expect(groupedRows[0].getAttribute("data-variant-count")).toBe("3");
  });

  it("entityDistribution is NOT grouped — entity count unchanged in array mode (entities view)", () => {
    setInsightsMock(entityInsights);

    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="entity_q"
        enabled={true}
      />
    );

    // In array mode, default view is "entities" — entityDistribution should pass through unchanged
    const barMocks = screen.getAllByTestId("bar-visualization-mock");
    const answerCounts = barMocks.map((el) =>
      Number(el.getAttribute("data-answer-count"))
    );
    // 3 entities should be passed directly (no grouping)
    expect(answerCounts.some((c) => c === 3)).toBe(true);
  });

  it("non-synonym answers are not merged — 2 distinct answers produce 2 groups", () => {
    setInsightsMock(baseInsights);

    render(
      <InsightsQuestionPanel
        jobId={mockJobId}
        questionKey="sample_size"
        enabled={true}
      />
    );

    // baseInsights has "273 studies" and "250 studies" — these are not synonyms
    // groupAnswersBySynonym should keep them as 2 separate groups
    const barMocks = screen.getAllByTestId("bar-visualization-mock");
    const answerCounts = barMocks.map((el) =>
      Number(el.getAttribute("data-answer-count"))
    );
    expect(answerCounts.some((c) => c === 2)).toBe(true);
  });
});
