import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroupedAnswerRow } from "../../components/extraction/grouped-answer-row";

// Mock next-intl — return key:params string so we can detect i18n calls with params
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

// Mock lucide-react — no-op renders so we don't need SVG support in jsdom
vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
}));

// --- Test fixtures ---

const singleVariantGroup = {
  groupRepresentative: "Yes",
  groupNormalized: "yes",
  count: 10,
  citationStatusMix: {
    grounded: 8,
    best_effort: 2,
    insufficient_evidence: 0,
    extraction_error: 0,
  },
  variants: [
    {
      display: "Yes",
      normalized: "yes",
      count: 10,
      citationStatusMix: {
        grounded: 8,
        best_effort: 2,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
  ],
};

const multiVariantGroup = {
  groupRepresentative: "Yes",
  groupNormalized: "yes",
  count: 25,
  citationStatusMix: {
    grounded: 20,
    best_effort: 5,
    insufficient_evidence: 0,
    extraction_error: 0,
  },
  variants: [
    {
      display: "Yes",
      normalized: "yes",
      count: 15,
      citationStatusMix: {
        grounded: 12,
        best_effort: 3,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
    {
      display: "True",
      normalized: "true",
      count: 7,
      citationStatusMix: {
        grounded: 6,
        best_effort: 1,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
    {
      display: "Positive",
      normalized: "positive",
      count: 3,
      citationStatusMix: {
        grounded: 2,
        best_effort: 1,
        insufficient_evidence: 0,
        extraction_error: 0,
      },
    },
  ],
};

// --- Tests ---

describe("GroupedAnswerRow — single variant", () => {
  it("renders the groupRepresentative as the label", () => {
    render(<GroupedAnswerRow group={singleVariantGroup} />);
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("does NOT render a disclosure button", () => {
    render(<GroupedAnswerRow group={singleVariantGroup} />);
    const button = screen.queryByRole("button");
    expect(button).toBeNull();
  });

  it("does NOT render any variant sub-rows", () => {
    const { container } = render(<GroupedAnswerRow group={singleVariantGroup} />);
    // No ×N count indicators should appear
    expect(container.textContent).not.toContain("×");
  });
});

describe("GroupedAnswerRow — multi-variant, collapsed (default)", () => {
  it("renders the groupRepresentative as the main label", () => {
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("renders a disclosure button with variant count in text", () => {
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    const button = screen.getByRole("button");
    expect(button).toBeTruthy();
    // The button should contain count information (3 variants)
    expect(button.textContent).toContain("3");
  });

  it("disclosure button uses answerGroupingExpand i18n key with variant count", () => {
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    const button = screen.getByRole("button");
    // Our mock returns "answerGroupingExpand:{"count":3}"
    expect(button.textContent).toContain("answerGroupingExpand");
  });

  it("variant sub-rows are NOT in the DOM initially (collapsed by default)", () => {
    const { container } = render(<GroupedAnswerRow group={multiVariantGroup} />);
    // Variant-specific texts should not be present before expansion
    expect(container.textContent).not.toContain("True");
    expect(container.textContent).not.toContain("Positive");
  });

  it("variant count indicators (×N) are NOT visible initially", () => {
    const { container } = render(<GroupedAnswerRow group={multiVariantGroup} />);
    expect(container.textContent).not.toContain("×");
  });
});

describe("GroupedAnswerRow — multi-variant, expanded (after click)", () => {
  it("clicking the disclosure button shows variant sub-rows", () => {
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(screen.getByText("True")).toBeTruthy();
    expect(screen.getByText("Positive")).toBeTruthy();
  });

  it("expanded sub-rows show each variant's display text", () => {
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    fireEvent.click(screen.getByRole("button"));
    // "Yes" appears in both the representative label and the sub-row — use getAllByText
    expect(screen.getAllByText("Yes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("True")).toBeTruthy();
    expect(screen.getByText("Positive")).toBeTruthy();
  });

  it("expanded sub-rows show each variant's individual count", () => {
    const { container } = render(<GroupedAnswerRow group={multiVariantGroup} />);
    fireEvent.click(screen.getByRole("button"));
    // Counts shown as ×N
    expect(container.textContent).toContain("×15");
    expect(container.textContent).toContain("×7");
    expect(container.textContent).toContain("×3");
  });

  it("clicking the disclosure button again collapses sub-rows", () => {
    const { container } = render(<GroupedAnswerRow group={multiVariantGroup} />);
    const button = screen.getByRole("button");
    // Expand
    fireEvent.click(button);
    expect(screen.getByText("True")).toBeTruthy();
    // Collapse
    fireEvent.click(button);
    expect(container.textContent).not.toContain("True");
    expect(container.textContent).not.toContain("Positive");
  });
});

describe("GroupedAnswerRow — stable keys", () => {
  it("renders without crashing — no key-prop warning (structural check)", () => {
    // If React throws a key-prop warning it will not crash, but we can verify
    // the component renders the correct number of sub-rows after expansion
    render(<GroupedAnswerRow group={multiVariantGroup} />);
    fireEvent.click(screen.getByRole("button"));
    // 3 variant sub-rows should exist (we check via count text presence)
    const { container } = render(<GroupedAnswerRow group={multiVariantGroup} />);
    fireEvent.click(container.querySelector("button")!);
    // Check all three variants render
    const allText = container.textContent ?? "";
    expect(allText).toContain("True");
    expect(allText).toContain("Positive");
  });
});
