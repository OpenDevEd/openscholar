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
});
