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

vi.mock("@/lib/extraction/card-thresholds", () => ({
  getCardColor: (_metricType: string, value: number) => {
    if (value >= 0.75) return "green";
    if (value >= 0.50) return "yellow";
    return "red";
  },
  BORDER_COLOR_CLASSES: {
    green: "border-l-4 border-l-emerald-500",
    yellow: "border-l-4 border-l-amber-500",
    red: "border-l-4 border-l-red-500",
  },
  CARD_TINT_CLASSES: {
    green: "bg-emerald-50/40",
    yellow: "bg-amber-50/40",
    red: "bg-red-50/40",
  },
  ICON_COLOR_CLASSES: {
    green: "text-emerald-600",
    yellow: "text-amber-600",
    red: "text-red-600",
  },
  pct: (value: number) => `${Math.round(value * 100)}%`,
}));

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

  it("cards appear in correct DOM order: answered before grounded", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("answered")).toBeLessThan(text.indexOf("grounded"));
  });

  it("cards appear in correct DOM order: grounded before bestEffort", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("grounded")).toBeLessThan(text.indexOf("bestEffort"));
  });

  it("cards appear in correct DOM order: bestEffort before noContentPapers", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
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

  it("answered card at 0.80 has emerald border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.80} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const answeredCard = Array.from(cards).find((c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded"));
    expect(answeredCard?.className).toContain("border-l-emerald-500");
  });

  it("answered card at 0.60 has amber border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.60} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const answeredCard = Array.from(cards).find((c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded"));
    expect(answeredCard?.className).toContain("border-l-amber-500");
  });

  it("answered card at 0.30 has red border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} answeredRate={0.30} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const answeredCard = Array.from(cards).find((c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded"));
    expect(answeredCard?.className).toContain("border-l-red-500");
  });

  it("grounded card at 0.75 has emerald border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.75} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const groundedCard = Array.from(cards).find((c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered"));
    expect(groundedCard?.className).toContain("border-l-emerald-500");
  });

  it("grounded card at 0.55 has amber border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.55} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const groundedCard = Array.from(cards).find((c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered"));
    expect(groundedCard?.className).toContain("border-l-amber-500");
  });

  it("grounded card at 0.40 has red border class", () => {
    const { container } = render(<SummaryCards {...defaultProps} groundedRate={0.40} />);
    const cards = container.querySelectorAll(".rounded-xl");
    const groundedCard = Array.from(cards).find((c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered"));
    expect(groundedCard?.className).toContain("border-l-red-500");
  });

  it("shows percentage values for answered and grounded rates", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("60%");
    expect(container.textContent).toContain("15%");
  });
});
