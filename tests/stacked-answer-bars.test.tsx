import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StackedAnswerBars } from "../components/extraction/stacked-answer-bars";

// Mock next-intl — return key as value (avoids NextIntlClientProvider setup)
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock tooltip to render content in DOM (avoid Radix portals in unit tests)
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

  it("renders tooltip content for each citation status segment", () => {
    render(<StackedAnswerBars answers={sampleAnswers} maxCount={80} />);
    const tooltips = screen.getAllByTestId("tooltip-content");
    expect(tooltips.length).toBeGreaterThanOrEqual(1);
  });

  it("renders empty state message when all answers have count=0", () => {
    const emptyAnswers = sampleAnswers.map(a => ({ ...a, count: 0 }));
    render(<StackedAnswerBars answers={emptyAnswers} maxCount={0} />);
    expect(screen.getByText("noAnswerValues")).toBeDefined();
  });
});
