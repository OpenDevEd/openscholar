import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "../components/extraction/summary-cards";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/components/extraction/confidence-badge", () => ({
  ConfidenceBadge: () => <div data-testid="confidence-badge-mock" />,
}));

vi.mock("lucide-react", () => ({
  CheckCircle2: () => <span data-testid="icon-check" />,
  ShieldCheck: () => <span data-testid="icon-shield" />,
  AlertTriangle: () => <span data-testid="icon-alert" />,
  FileX: () => <span data-testid="icon-file-x" />,
  Gauge: () => <span data-testid="icon-gauge" />,
}));

vi.mock("@/lib/feature-flags/hook", () => ({
  useFeatureFlag: () => true,
}));

// Real thresholds — we want the test to fail if the mapping drifts.
// Unit tests for the threshold math live in tests/lib/card-thresholds.test.ts.
vi.mock("@/lib/animation-config", () => ({
  cardEntrance: { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } },
  cardEntranceTransition: (delay = 0) => ({ duration: 0.35, delay }),
}));

const defaultProps = {
  answeredRate: 0.75, groundedRate: 0.60, bestEffortRate: 0.15,
  noContentCount: 3, totalPapers: 20, abstractOnlyCount: 5, averageConfidence: 0.82,
};

describe("SummaryCards component", () => {
  it("renders all metric cards when all values are present", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    expect(container.textContent).toContain("answered");
    expect(container.textContent).toContain("grounded");
    expect(container.textContent).toContain("bestEffort");
    expect(container.textContent).toContain("noContentPapers");
    expect(screen.getByTestId("confidence-area")).toBeTruthy();
  });

  it("renders confidence badge inside the confidence-area", () => {
    render(<SummaryCards {...defaultProps} />);
    const area = screen.getByTestId("confidence-area");
    expect(area.querySelector("[data-testid='confidence-badge-mock']")).toBeTruthy();
  });

  it("cards appear in correct DOM order: answered, grounded, bestEffort, noContentPapers", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("answered")).toBeLessThan(text.indexOf("grounded"));
    expect(text.indexOf("grounded")).toBeLessThan(text.indexOf("bestEffort"));
    expect(text.indexOf("bestEffort")).toBeLessThan(text.indexOf("noContentPapers"));
  });

  it("hides bestEffort card when bestEffortRate=0", () => {
    const { container } = render(<SummaryCards {...defaultProps} bestEffortRate={0} />);
    expect(container.textContent).not.toContain("bestEffort");
  });

  it("hides noContentPapers card when noContentCount=0", () => {
    const { container } = render(<SummaryCards {...defaultProps} noContentCount={0} />);
    expect(container.textContent).not.toContain("noContentPapers");
  });

  it("shows only answered and grounded cards (plus confidence) when bestEffortRate=0 AND noContentCount=0", () => {
    const { container } = render(<SummaryCards {...defaultProps} bestEffortRate={0} noContentCount={0} />);
    expect(container.textContent).toContain("answered");
    expect(container.textContent).toContain("grounded");
    expect(container.textContent).not.toContain("bestEffort");
    expect(container.textContent).not.toContain("noContentPapers");
    expect(screen.getByTestId("confidence-area")).toBeTruthy();
  });

  it("answered card exposes its threshold color role via data-color-role (green at/above 0.75)", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.80} />);
    const card = container.querySelector('[data-card="answered"]');
    expect(card).toHaveAttribute("data-color-role", "green");
  });

  it("answered card exposes 'yellow' color role between 0.50 and 0.75", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.60} />);
    const card = container.querySelector('[data-card="answered"]');
    expect(card).toHaveAttribute("data-color-role", "yellow");
  });

  it("answered card exposes 'red' color role below 0.50", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.30} />);
    const card = container.querySelector('[data-card="answered"]');
    expect(card).toHaveAttribute("data-color-role", "red");
  });

  it("grounded card exposes 'green' color role at/above 0.70", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.75} />);
    const card = container.querySelector('[data-card="grounded"]');
    expect(card).toHaveAttribute("data-color-role", "green");
  });

  it("grounded card exposes 'yellow' color role between 0.50 and 0.70", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.55} />);
    const card = container.querySelector('[data-card="grounded"]');
    expect(card).toHaveAttribute("data-color-role", "yellow");
  });

  it("grounded card exposes 'red' color role below 0.50", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.40} />);
    const card = container.querySelector('[data-card="grounded"]');
    expect(card).toHaveAttribute("data-color-role", "red");
  });

  it("shows percentage values for answered, grounded, and bestEffort rates", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("60%");
    expect(container.textContent).toContain("15%");
  });
});
