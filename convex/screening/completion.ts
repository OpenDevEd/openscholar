import type { Doc } from "../_generated/dataModel";

type ScreeningJobStatus = Doc<"screeningJobs">["status"];
type ScreeningResultStatus = Doc<"screeningResults">["status"];

// The answers themselves go to the job's screening; the row keeps what is worked out from them.
export type CompletedScreeningRowDetails = {
  score: number;
  stars: number;
  qualified: boolean;
  aiMetadata: {
    confidence: number;
  };
};

type CompletionTransitionInput = {
  currentRowStatus: ScreeningResultStatus;
  jobStatus: ScreeningJobStatus;
  resultKind: "success" | "failure";
  completedRowDetails?: CompletedScreeningRowDetails;
};

export type CompletionTransition =
  | {
      kind: "noop";
    }
  | {
      kind: "patch";
      rowPatch:
        | ({
            status: "completed";
          } & CompletedScreeningRowDetails)
        | {
            status: "failed" | "skipped";
          };
    };

export function deriveCompletionTransition(
  input: CompletionTransitionInput,
): CompletionTransition {
  if (input.currentRowStatus !== "processing") {
    return { kind: "noop" };
  }

  if (input.resultKind !== "success") {
    return {
      kind: "patch",
      rowPatch: { status: "failed" },
    };
  }

  if (input.jobStatus !== "processing") {
    return {
      kind: "patch",
      rowPatch: { status: "skipped" },
    };
  }

  if (!input.completedRowDetails) {
    throw new Error(
      "deriveCompletionTransition requires completedRowDetails for success transitions",
    );
  }

  return {
    kind: "patch",
    rowPatch: {
      status: "completed",
      ...input.completedRowDetails,
    },
  };
}
