import type { WorkId } from "@convex-dev/workpool";
import type { Doc } from "../_generated/dataModel";

export const SCREENING_ACTIVE_JOB_STATUSES = ["processing"] as const;

export const SCREENING_TERMINAL_JOB_STATUSES = [
  "completed",
  "cancelled",
  "failed",
  "creditsExhausted",
] as const;

export const SCREENING_TERMINAL_RESULT_STATUSES = [
  "completed",
  "failed",
  "skipped",
] as const;

type CancelableResultRow = Pick<Doc<"screeningResults">, "status" | "workId">;

export function isActiveScreeningJobStatus(
  status: Doc<"screeningJobs">["status"]
): boolean {
  return SCREENING_ACTIVE_JOB_STATUSES.includes(
    status as (typeof SCREENING_ACTIVE_JOB_STATUSES)[number]
  );
}

export function isTerminalScreeningJobStatus(
  status: Doc<"screeningJobs">["status"]
): boolean {
  return SCREENING_TERMINAL_JOB_STATUSES.includes(
    status as (typeof SCREENING_TERMINAL_JOB_STATUSES)[number]
  );
}

export function isTerminalScreeningResultStatus(
  status: Doc<"screeningResults">["status"]
): boolean {
  return SCREENING_TERMINAL_RESULT_STATUSES.includes(
    status as (typeof SCREENING_TERMINAL_RESULT_STATUSES)[number]
  );
}

export function getCancelableScreeningWorkIds(
  results: CancelableResultRow[]
): WorkId[] {
  return results.flatMap((result) => {
    if (!result.workId || isTerminalScreeningResultStatus(result.status)) {
      return [];
    }

    return [result.workId as WorkId];
  });
}
