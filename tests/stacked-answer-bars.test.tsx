import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StackedAnswerBars } from "../components/extraction/stacked-answer-bars";

// Mock Recharts to avoid jsdom canvas/SVG issues — same pattern as Phase 84
vi.mock("recharts", () => ({
  BarChart: ({ children, data }: any) => (
    <div data-testid="recharts-mock" data-count={data?.length}>{children}</div>
  ),
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <>{children}</>,
}));

const sampleAnswers = [
  {
    answer: "Yes",
    count: 80,
    citationStatusMix: { grounded: 60, best_effort: 15, insufficient_evidence: 4, extraction_error: 1 },
  },
  {
    answer: "No",
    count: 20,
    citationStatusMix: { grounded: 10, best_effort: 5, insufficient_evidence: 4, extraction_error: 1 },
  },
];

describe("StackedAnswerBars", () => {
  it("renders one answer-bar-row per answer item", () => {
    render(<StackedAnswerBars answers={sampleAnswers} maxCount={80} />);
    const rows = screen.getAllByTestId("answer-bar-row");
    expect(rows).toHaveLength(2);
  });

  it("renders answer labels in each row", () => {
    render(<StackedAnswerBars answers={sampleAnswers} maxCount={80} />);
    expect(screen.getByText("Yes")).toBeDefined();
    expect(screen.getByText("No")).toBeDefined();
  });

  it("renders a Recharts mock for each answer row", () => {
    render(<StackedAnswerBars answers={sampleAnswers} maxCount={80} />);
    const charts = screen.getAllByTestId("recharts-mock");
    expect(charts.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state message when all answers have count=0", () => {
    const emptyAnswers = sampleAnswers.map(a => ({ ...a, count: 0 }));
    render(<StackedAnswerBars answers={emptyAnswers} maxCount={0} />);
    expect(screen.getByText(/no answers/i)).toBeDefined();
  });
});
