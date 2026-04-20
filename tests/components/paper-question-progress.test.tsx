/**
 * @vitest-environment jsdom
 *
 * Plan-07 — behavior tests for <PaperQuestionProgress>.
 *
 * Assertions target data-*, aria-label, and role. Never asserts on
 * Tailwind strings (project testing doctrine).
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, unknown>) => {
      if (params === undefined) return key;
      return `${key}:${JSON.stringify(params)}`;
    },
}));

import {
  PaperQuestionProgress,
  type QuestionProgressResult,
} from "@/components/extraction/paper-question-progress";

describe("<PaperQuestionProgress>", () => {
  it("exposes paperStatus and completed/total via data-* attributes", () => {
    const results: QuestionProgressResult[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
      { status: "extracting" },
    ];
    render(
      <PaperQuestionProgress
        paperStatus="extracting"
        results={results}
        totalQuestions={5}
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-paper-status", "extracting");
    expect(group).toHaveAttribute("data-question-progress", "4/5");
    expect(group).toHaveAttribute("data-completed-count", "4");
    expect(group).toHaveAttribute("data-total-count", "5");
    expect(group).toHaveAttribute("data-failed-count", "0");
    expect(group).toHaveAttribute("data-retrying-count", "0");
  });

  it("surfaces failed questions in data-failed-count", () => {
    const results: QuestionProgressResult[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "failed" },
      { status: "failed" },
      { status: "pending" },
    ];
    render(
      <PaperQuestionProgress
        paperStatus="failed"
        results={results}
        totalQuestions={5}
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-paper-status", "failed");
    expect(group).toHaveAttribute("data-failed-count", "2");
    expect(group).toHaveAttribute("data-question-progress", "2/5");
  });

  it("counts retrying only when status is extracting and attemptCount > 1", () => {
    const results: QuestionProgressResult[] = [
      { status: "completed" },
      { status: "extracting", attemptCount: 1 }, // first attempt — not retrying
      { status: "extracting", attemptCount: 3 }, // second retry — IS retrying
      { status: "extracting", attemptCount: 2 }, // first retry — IS retrying
    ];
    render(
      <PaperQuestionProgress
        paperStatus="extracting"
        results={results}
        totalQuestions={4}
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-retrying-count", "2");
  });

  it("falls back to totalQuestions when results array is shorter (pending seed)", () => {
    // Happens right after job creation: only the first question has a
    // row, but the user sees 1/10 not 1/1.
    const results: QuestionProgressResult[] = [{ status: "extracting" }];
    render(
      <PaperQuestionProgress
        paperStatus="extracting"
        results={results}
        totalQuestions={10}
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-question-progress", "0/10");
    expect(group).toHaveAttribute("data-total-count", "10");
  });

  it("uses results.length when it exceeds totalQuestions (stale question count)", () => {
    // Defensive: if the schema ever drifts and more result rows exist
    // than declared questions, show the larger number rather than lying.
    const results: QuestionProgressResult[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
    ];
    render(
      <PaperQuestionProgress
        paperStatus="completed"
        results={results}
        totalQuestions={2}
      />,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute("data-question-progress", "3/3");
  });

  it("exposes a localized aria-label derived from the counts", () => {
    const results: QuestionProgressResult[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "pending" },
    ];
    render(
      <PaperQuestionProgress
        paperStatus="extracting"
        results={results}
        totalQuestions={3}
      />,
    );
    const group = screen.getByRole("group");
    const label = group.getAttribute("aria-label") ?? "";
    // The mock passes params through in JSON form. The real implementation
    // localizes; the test pins that completed/total flow into the aria-label.
    expect(label).toContain("completed");
    expect(label).toContain("2");
    expect(label).toContain("3");
  });
});
