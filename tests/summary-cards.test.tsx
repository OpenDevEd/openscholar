import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SummaryCards } from "../components/extraction/summary-cards";

// Mock next-intl — return key as value (avoids NextIntlClientProvider setup)
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock ConfidenceBadge to isolate SummaryCards logic
vi.mock("@/components/extraction/confidence-badge", () => ({
  ConfidenceBadge: () => <div data-testid="confidence-badge-mock" />,
}));

// Mock card-thresholds with deterministic getCardColor and real BORDER_COLOR_CLASSES
vi.mock("@/lib/extraction/card-thresholds", () => ({
  getCardColor: (metricType: string, value: number) => {
    if (value >= 0.75) return "green";
    if (value >= 0.50) return "yellow";
    return "red";
  },
  BORDER_COLOR_CLASSES: {
    green: "border-l-4 border-green-400",
    yellow: "border-l-4 border-yellow-400",
    red: "border-l-4 border-red-400",
  },
}));

const defaultProps = {
  answeredRate: 0.75,
  groundedRate: 0.60,
  bestEffortRate: 0.15,
  noContentCount: 3,
  totalPapers: 20,
  abstractOnlyCount: 5,
  averageConfidence: 0.82,
};

describe("SummaryCards component", () => {
  it("renders all metric cards when all values are present", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    // Should have: answered, grounded, bestEffort, noContent + confidence area
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
    const answeredIdx = text.indexOf("answered");
    const groundedIdx = text.indexOf("grounded");
    expect(answeredIdx).toBeLessThan(groundedIdx);
  });

  it("cards appear in correct DOM order: grounded before bestEffort", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
    const groundedIdx = text.indexOf("grounded");
    const bestEffortIdx = text.indexOf("bestEffort");
    expect(groundedIdx).toBeLessThan(bestEffortIdx);
  });

  it("cards appear in correct DOM order: bestEffort before noContentPapers", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    const text = container.textContent ?? "";
    const bestEffortIdx = text.indexOf("bestEffort");
    const noContentIdx = text.indexOf("noContentPapers");
    expect(bestEffortIdx).toBeLessThan(noContentIdx);
  });

  it("hides bestEffort card when bestEffortRate=0", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} bestEffortRate={0} />
    );
    expect(container.textContent).not.toContain("bestEffort");
  });

  it("hides noContentPapers card when noContentCount=0", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} noContentCount={0} />
    );
    expect(container.textContent).not.toContain("noContentPapers");
  });

  it("shows only answered and grounded cards (plus confidence) when bestEffortRate=0 AND noContentCount=0", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} bestEffortRate={0} noContentCount={0} />
    );
    expect(container.textContent).toContain("answered");
    expect(container.textContent).toContain("grounded");
    expect(container.textContent).not.toContain("bestEffort");
    expect(container.textContent).not.toContain("noContentPapers");
    expect(screen.getByTestId("confidence-area")).toBeTruthy();
  });

  it("answered card at 0.80 has border-green-400 class", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} answeredRate={0.80} />
    );
    // Find the card that contains the "answered" label
    const cards = container.querySelectorAll(".rounded-lg");
    const answeredCard = Array.from(cards).find(
      (c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded")
    );
    expect(answeredCard?.className).toContain("border-green-400");
  });

  it("answered card at 0.60 has border-yellow-400 class", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} answeredRate={0.60} />
    );
    const cards = container.querySelectorAll(".rounded-lg");
    const answeredCard = Array.from(cards).find(
      (c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded")
    );
    expect(answeredCard?.className).toContain("border-yellow-400");
  });

  it("answered card at 0.30 has border-red-400 class", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} answeredRate={0.30} />
    );
    const cards = container.querySelectorAll(".rounded-lg");
    const answeredCard = Array.from(cards).find(
      (c) => c.textContent?.includes("answered") && !c.textContent?.includes("grounded")
    );
    expect(answeredCard?.className).toContain("border-red-400");
  });

  it("grounded card at 0.75 has border-green-400 class (quality threshold)", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} groundedRate={0.75} />
    );
    const cards = container.querySelectorAll(".rounded-lg");
    const groundedCard = Array.from(cards).find(
      (c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered")
    );
    expect(groundedCard?.className).toContain("border-green-400");
  });

  it("grounded card at 0.55 has border-yellow-400 class (quality threshold)", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} groundedRate={0.55} />
    );
    const cards = container.querySelectorAll(".rounded-lg");
    const groundedCard = Array.from(cards).find(
      (c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered")
    );
    expect(groundedCard?.className).toContain("border-yellow-400");
  });

  it("grounded card at 0.40 has border-red-400 class (quality threshold)", () => {
    const { container } = render(
      <SummaryCards {...defaultProps} groundedRate={0.40} />
    );
    const cards = container.querySelectorAll(".rounded-lg");
    const groundedCard = Array.from(cards).find(
      (c) => c.textContent?.includes("grounded") && !c.textContent?.includes("answered")
    );
    expect(groundedCard?.className).toContain("border-red-400");
  });

  it("shows percentage values for answered and grounded rates", () => {
    const { container } = render(<SummaryCards {...defaultProps} />);
    expect(container.textContent).toContain("75%"); // answeredRate 0.75
    expect(container.textContent).toContain("60%"); // groundedRate 0.60
    expect(container.textContent).toContain("15%"); // bestEffortRate 0.15
  });
});
