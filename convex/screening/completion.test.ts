import { describe, expect, it } from "vitest";
import {
  deriveCompletionTransition,
  type CompletedScreeningRowDetails,
} from "./completion";

const completedRowDetails: CompletedScreeningRowDetails = {
  score: 3,
  stars: 2,
  qualified: true,
  outcome: "included",
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
        outcome: "included",
        aiMetadata: { confidence: 0.87 },
      },
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
      rowPatch: { status: "failed", outcome: "failed" },
    });
  });

  it("skips a paper whose queued work was dropped, since it was never screened", () => {
    expect(deriveCompletionTransition({ currentRowStatus: "processing", jobStatus: "cancelled", resultKind: "canceled" })).toEqual({ kind: "patch", rowPatch: { status: "skipped" } });
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
