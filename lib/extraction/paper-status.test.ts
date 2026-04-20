import { describe, expect, it } from "vitest";
import { aggregatePaperStatus } from "@/lib/extraction/paper-status";

describe("aggregatePaperStatus", () => {
  it("R1: empty input → pending / zero counters", () => {
    expect(aggregatePaperStatus([])).toEqual({
      status: "pending",
      completedQuestions: 0,
      failedQuestions: 0,
    });
  });

  it("R2: all completed → completed / N answered", () => {
    const results = [
      { status: "completed" as const },
      { status: "completed" as const },
      { status: "completed" as const },
    ];
    expect(aggregatePaperStatus(results)).toEqual({
      status: "completed",
      completedQuestions: 3,
      failedQuestions: 0,
    });
  });

  it("R3: mix of completed + hard-failed (non-retryable code) → completed with failedQuestions counter", () => {
    const results = [
      { status: "completed" as const },
      { status: "completed" as const },
      { status: "failed" as const, lastError: { code: "pdf_invalid" as const } },
    ];
    expect(aggregatePaperStatus(results)).toEqual({
      status: "completed",
      completedQuestions: 2,
      failedQuestions: 1,
    });
  });

  it("R4: mix of completed + retryable-failed (not yet maxed out) → still extracting", () => {
    const results = [
      { status: "completed" as const },
      { status: "completed" as const },
      {
        status: "failed" as const,
        lastError: { code: "rate_limit" as const },
        attemptCount: 1,
      },
    ];
    expect(aggregatePaperStatus(results).status).toBe("extracting");
  });

  it("R5: all hard-failed → paper failed with failedQuestions=N", () => {
    const results = [
      { status: "failed" as const, lastError: { code: "pdf_invalid" as const } },
      { status: "failed" as const, lastError: { code: "paper_not_found" as const } },
      { status: "failed" as const, lastError: { code: "moderation" as const } },
    ];
    expect(aggregatePaperStatus(results)).toEqual({
      status: "failed",
      completedQuestions: 0,
      failedQuestions: 3,
    });
  });
});
