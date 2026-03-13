import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionListItem } from "../components/extraction/question-list-item";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

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
  it("renders status dot with correct CSS class for complete state", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={10} total={10} />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).className).toContain("bg-emerald-500");
  });

  it("renders status dot with correct CSS class for partial state", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={5} total={10} />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).className).toContain("bg-amber-500");
  });

  it("renders status dot with correct CSS class for empty state", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={0} total={10} />
    );
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).className).toContain("bg-gray-300");
  });

  it("renders progress bar with correct percentage", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} />);
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "7");
    expect(progressbar).toHaveAttribute("aria-valuemax", "10");
  });

  it("renders 0% and not NaN when answered=0 and total=0", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={0} total={0} />);
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar).toHaveAttribute("aria-valuenow", "0");
    expect(progressbar).toHaveAttribute("aria-valuemax", "1");
    expect(screen.getByText("0%")).toBeTruthy();
  });

  it("displays percentage text '70%' alongside progress bar", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} />);
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it("calls onClick when button is clicked", async () => {
    const onClick = vi.fn();
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} onClick={onClick} />);
    screen.getByRole("button").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies selected styling when isSelected=true", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} isSelected={true} />);
    const button = screen.getByRole("button");
    expect(button.className).toContain("bg-primary");
  });
});
