import { describe, expect, it } from "vitest";
import { buildScreeningProgressSnapshot } from "./progress";

describe("buildScreeningProgressSnapshot", () => {
  it("treats completed and skipped as handled while failed stays separate", () => {
    expect(
      buildScreeningProgressSnapshot({
        status: "processing",
        totalPapers: 10,
        completedCount: 2,
        skippedCount: 1,
        failedCount: 4,
        qualifiedCount: 2,
      }),
    ).toEqual({
      status: "processing",
      totalPapers: 10,
      processedPapers: 3,
      failedPapers: 4,
      qualifiedPapers: 2,
      percentComplete: 70,
    });
  });

  it("caps active jobs at 99 percent", () => {
    expect(
      buildScreeningProgressSnapshot({
        status: "processing",
        totalPapers: 200,
        completedCount: 199,
        skippedCount: 0,
        failedCount: 0,
        qualifiedCount: 100,
      }).percentComplete,
    ).toBe(99);
  });

  it("returns 100 percent for terminal jobs even if the raw math is lower", () => {
    expect(
      buildScreeningProgressSnapshot({
        status: "completed",
        totalPapers: 10,
        completedCount: 8,
        skippedCount: 0,
        failedCount: 1,
        qualifiedCount: 5,
      }).percentComplete,
    ).toBe(100);
  });

  it("returns zero counts safely for zero-paper jobs", () => {
    expect(
      buildScreeningProgressSnapshot({
        status: "processing",
        totalPapers: 0,
        completedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        qualifiedCount: 0,
      }),
    ).toEqual({
      status: "processing",
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      percentComplete: 0,
    });
  });
});
