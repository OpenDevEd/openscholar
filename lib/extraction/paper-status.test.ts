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
});
