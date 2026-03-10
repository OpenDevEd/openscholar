import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderTooltipContent } from "../components/extraction/stacked-answer-bars";

describe("renderTooltipContent", () => {
  it("returns null when active=false", () => {
    const result = renderTooltipContent({ active: false, payload: [] });
    expect(result).toBeNull();
  });

  it("returns null when payload is empty", () => {
    const result = renderTooltipContent({ active: true, payload: [] });
    expect(result).toBeNull();
  });

  it("shows integer count and percentage — never raw decimal", () => {
    const mockPayload = [
      {
        name: "grounded",
        value: 60,
        payload: { grounded: 60, best_effort: 15, insufficient_evidence: 4, extraction_error: 1 },
      },
    ];
    const element = renderTooltipContent({ active: true, payload: mockPayload });
    expect(element).not.toBeNull();
    // Render and check text does not contain raw decimal like "0.75"
    const { container } = render(element as React.ReactElement);
    expect(container.textContent).not.toMatch(/0\.\d{2}/);
    expect(container.textContent).toMatch(/60/); // count visible
    expect(container.textContent).toMatch(/%/);  // percentage sign visible
  });

  it("handles best_effort status correctly", () => {
    const mockPayload = [
      {
        name: "best_effort",
        value: 15,
        payload: { grounded: 60, best_effort: 15, insufficient_evidence: 4, extraction_error: 1 },
      },
    ];
    const element = renderTooltipContent({ active: true, payload: mockPayload });
    const { container } = render(element as React.ReactElement);
    expect(container.textContent).toMatch(/15/);
  });
});
