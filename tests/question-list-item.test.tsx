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

function getStatusDot(container: HTMLElement): HTMLElement {
  const dot = container.querySelector<HTMLElement>("[data-status]");
  if (!dot) throw new Error("status dot not found");
  return dot;
}

describe("QuestionListItem component", () => {
  it("exposes status='complete' when all papers are answered", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={10} total={10} />
    );
    expect(getStatusDot(container)).toHaveAttribute("data-status", "complete");
    // Accessible label backs the visual dot for screen-reader users.
    expect(screen.getByText("statusDotComplete")).toBeTruthy();
  });

  it("exposes status='partial' when some papers are answered", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={5} total={10} />
    );
    expect(getStatusDot(container)).toHaveAttribute("data-status", "partial");
    expect(screen.getByText("statusDotPartial")).toBeTruthy();
  });

  it("exposes status='empty' when no papers are answered", () => {
    const { container } = render(
      <QuestionListItem questionKey="q1" question="What is the sample size?" answered={0} total={10} />
    );
    expect(getStatusDot(container)).toHaveAttribute("data-status", "empty");
    expect(screen.getByText("statusDotEmpty")).toBeTruthy();
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

  it("reflects selection state via aria-pressed='true'", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} isSelected={true} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("reflects unselected state via aria-pressed='false'", () => {
    render(<QuestionListItem questionKey="q1" question="What is the sample size?" answered={7} total={10} isSelected={false} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });
});
