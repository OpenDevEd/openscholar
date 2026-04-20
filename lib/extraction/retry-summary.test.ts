import { describe, expect, it } from "vitest";
import {
  summarizeRetryable,
  type RetryableResultInput,
} from "@/lib/extraction/retry-summary";

describe("summarizeRetryable", () => {
  it("R1: empty list → zero counts and empty breakdown", () => {
    expect(summarizeRetryable([])).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });

  it("R2: only completed results → all zeros (no failures to retry)", () => {
    const results: RetryableResultInput[] = [
      { status: "completed" },
      { status: "completed" },
      { status: "completed" },
    ];
    expect(summarizeRetryable(results)).toEqual({
      retryableCount: 0,
      permanentCount: 0,
      permanentBreakdown: {},
    });
  });
});
