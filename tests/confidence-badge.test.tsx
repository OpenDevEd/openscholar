import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "../components/extraction/confidence-badge";

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

// Mock card-thresholds: return deterministic colors based on value
vi.mock("@/lib/extraction/card-thresholds", () => ({
  getConfidenceColor: (value: number) => {
    if (value >= 0.85) return "green";
    if (value >= 0.60) return "yellow";
    return "red";
  },
  BADGE_COLOR_CLASSES: {
    green: "bg-green-100 text-green-900 border-green-200",
    yellow: "bg-yellow-100 text-yellow-900 border-yellow-200",
    red: "bg-red-100 text-red-900 border-red-200",
  },
}));

// Mock confidence-messages: return deterministic key based on counts
vi.mock("@/lib/extraction/confidence-messages", () => ({
  getConfidenceTooltipKey: (
    abstractOnlyCount: number,
    noContentCount: number,
    totalPapers: number
  ) => {
    if (totalPapers > 0 && noContentCount === totalPapers) return "confidenceNoContent";
    if (abstractOnlyCount > 0) return "confidenceAbstractOnly";
    return "confidence";
  },
}));

const defaultProps = {
  abstractOnlyCount: 0,
  noContentCount: 0,
  totalPapers: 10,
};

describe("ConfidenceBadge", () => {
  it("renders 75% for value=0.75", () => {
    render(<ConfidenceBadge value={0.75} {...defaultProps} />);
    expect(screen.getByText("75%")).toBeTruthy();
  });

  it("renders 90% for value=0.90", () => {
    render(<ConfidenceBadge value={0.90} {...defaultProps} />);
    expect(screen.getByText("90%")).toBeTruthy();
  });

  it("renders 50% for value=0.50", () => {
    render(<ConfidenceBadge value={0.50} {...defaultProps} />);
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("renders 0% for value=0", () => {
    render(<ConfidenceBadge value={0} {...defaultProps} />);
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("renders 100% for value=1", () => {
    render(<ConfidenceBadge value={1} {...defaultProps} />);
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("has bg-yellow-100 class for value=0.75 (yellow threshold)", () => {
    const { container } = render(<ConfidenceBadge value={0.75} {...defaultProps} />);
    expect(container.innerHTML).toContain("bg-yellow-100");
  });

  it("has bg-green-100 class for value=0.90 (green threshold)", () => {
    const { container } = render(<ConfidenceBadge value={0.90} {...defaultProps} />);
    expect(container.innerHTML).toContain("bg-green-100");
  });

  it("has bg-red-100 class for value=0.50 (red threshold)", () => {
    const { container } = render(<ConfidenceBadge value={0.50} {...defaultProps} />);
    expect(container.innerHTML).toContain("bg-red-100");
  });

  it("renders a HelpCircle icon (svg element present)", () => {
    const { container } = render(<ConfidenceBadge value={0.75} {...defaultProps} />);
    // HelpCircle renders as an SVG
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("tooltip trigger is present in DOM when abstractOnlyCount=5, totalPapers=5", () => {
    const { container } = render(
      <ConfidenceBadge
        value={0.70}
        abstractOnlyCount={5}
        noContentCount={0}
        totalPapers={5}
      />
    );
    // The badge itself serves as the tooltip trigger
    expect(container.textContent).toContain("70%");
    // Tooltip content should be rendered in DOM (mocked)
    expect(screen.getByTestId("tooltip-content")).toBeTruthy();
  });

  it("does NOT render 'effective confidence' anywhere in output", () => {
    const { container } = render(<ConfidenceBadge value={0.75} {...defaultProps} />);
    expect(container.textContent?.toLowerCase()).not.toContain("effective confidence");
  });

  it("shows confidenceAbstractOnly tooltip when all papers are abstract-only", () => {
    render(
      <ConfidenceBadge
        value={0.70}
        abstractOnlyCount={5}
        noContentCount={0}
        totalPapers={5}
      />
    );
    const tooltipContent = screen.getByTestId("tooltip-content");
    // The i18n mock returns key as value
    expect(tooltipContent.textContent).toContain("confidenceAbstractOnly");
  });

  it("shows confidenceNoContent tooltip when all papers have no content", () => {
    render(
      <ConfidenceBadge
        value={0.50}
        abstractOnlyCount={0}
        noContentCount={5}
        totalPapers={5}
      />
    );
    const tooltipContent = screen.getByTestId("tooltip-content");
    expect(tooltipContent.textContent).toContain("confidenceNoContent");
  });

  it("uses bg-green-100 for value=0.85 (boundary)", () => {
    const { container } = render(<ConfidenceBadge value={0.85} {...defaultProps} />);
    expect(container.innerHTML).toContain("bg-green-100");
  });

  it("uses bg-yellow-100 for value=0.60 (boundary)", () => {
    const { container } = render(<ConfidenceBadge value={0.60} {...defaultProps} />);
    expect(container.innerHTML).toContain("bg-yellow-100");
  });
});
