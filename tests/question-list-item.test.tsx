import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionListItem } from "../components/extraction/question-list-item";

// Mock next-intl — return key as value
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock Progress component to expose aria attributes via a standard role=progressbar div
vi.mock("@/components/ui/progress", () => ({
  Progress: ({
    value,
    "aria-valuenow": ariaNow,
    "aria-valuemin": ariaMin,
    "aria-valuemax": ariaMax,
    "aria-label": ariaLabel,
  }: {
    value?: number;
    "aria-valuenow"?: number;
    "aria-valuemin"?: number;
    "aria-valuemax"?: number;
    "aria-label"?: string;
  }) => (
    <div
      role="progressbar"
      aria-valuenow={ariaNow}
      aria-valuemin={ariaMin}
      aria-valuemax={ariaMax}
      aria-label={ariaLabel}
      data-value={value}
    />
  ),
}));

describe("QuestionListItem component", () => {
  it("renders status dot with correct color for complete state", () => {
    const { container } = render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={10}
        total={10}
      />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.backgroundColor).toBe("rgb(16, 185, 129)");
  });

  it("renders status dot with correct color for partial state", () => {
    const { container } = render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={5}
        total={10}
      />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.backgroundColor).toBe("rgb(245, 158, 11)");
  });

  it("renders status dot with correct color for empty state", () => {
    const { container } = render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={0}
        total={10}
      />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.backgroundColor).toBe("rgb(209, 213, 219)");
  });

  it("renders progress bar with correct percentage", () => {
    render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={7}
        total={10}
      />
    );
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "7");
    expect(progressbar).toHaveAttribute("aria-valuemax", "10");
  });

  it("renders 0% and not NaN when answered=0 and total=0", () => {
    render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={0}
        total={0}
      />
    );
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar).toHaveAttribute("aria-valuemax", "1");
    // Percentage text should be "0%" not "NaN%"
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("displays percentage text '70%' alongside progress bar", () => {
    render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={7}
        total={10}
      />
    );
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it("calls onClick when button is clicked", async () => {
    const onClick = vi.fn();
    render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={7}
        total={10}
        onClick={onClick}
      />
    );
    screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies selected styling when isSelected=true", () => {
    render(
      <QuestionListItem
        questionKey="q1"
        question="What is the sample size?"
        answered={7}
        total={10}
        isSelected={true}
      />
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-primary/5");
  });
});
