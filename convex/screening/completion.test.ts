import { describe, expect, it } from "vitest";
import {
  deriveCompletionTransition,
  type CompletedScreeningRowDetails,
} from "./completion";

const completedRowDetails: CompletedScreeningRowDetails = {
  score: 3,
  stars: 2,
  qualified: true,
  aiMetadata: { confidence: 0.87 },
};

describe("deriveCompletionTransition", () => {
  it("returns a completed row transition for successful work on an active job", () => {
    expect(
      deriveCompletionTransition({
        currentRowStatus: "processing",
        jobStatus: "processing",
        resultKind: "success",
        completedRowDetails,
      }),
    ).toEqual({
      kind: "patch",
      rowPatch: {
        status: "completed",
        score: 3,
        stars: 2,
        qualified: true,
        aiMetadata: { confidence: 0.87 },
      },
      aggregateStatus: "completed",
      aggregateQualified: true,
      scheduleQualifiedPersistence: true,
      scheduleJobFinalization: true,
    });
  });

  it("returns a skipped row transition with no side-effect follow-up for terminal jobs", () => {
    expect(
      deriveCompletionTransition({
        currentRowStatus: "processing",
        jobStatus: "cancelled",
        resultKind: "success",
      }),
    ).toEqual({
      kind: "patch",
      rowPatch: { status: "skipped" },
      aggregateStatus: "skipped",
      aggregateQualified: false,
      scheduleQualifiedPersistence: false,
      scheduleJobFinalization: true,
    });
  });

  it("returns a failed row transition for failed work", () => {
    expect(
      deriveCompletionTransition({
        currentRowStatus: "processing",
        jobStatus: "processing",
        resultKind: "failure",
      }),
    ).toEqual({
      kind: "patch",
      rowPatch: { status: "failed" },
      aggregateStatus: "failed",
      aggregateQualified: false,
      scheduleQualifiedPersistence: false,
      scheduleJobFinalization: true,
    });
  });

  it("does not schedule library persistence for completed but non-qualified rows", () => {
    expect(
      deriveCompletionTransition({
        currentRowStatus: "processing",
        jobStatus: "processing",
        resultKind: "success",
        completedRowDetails: {
          ...completedRowDetails,
          qualified: false,
        },
      }),
    ).toMatchObject({
      kind: "patch",
      rowPatch: {
        status: "completed",
        qualified: false,
      },
      scheduleQualifiedPersistence: false,
      scheduleJobFinalization: true,
    });
  });

  it("no-ops for rows that are already terminal", () => {
    expect(
      deriveCompletionTransition({
        currentRowStatus: "completed",
        jobStatus: "processing",
        resultKind: "success",
        completedRowDetails,
      }),
    ).toEqual({ kind: "noop" });
  });
});
