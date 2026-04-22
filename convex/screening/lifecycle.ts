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

export function getCancelableScreeningWorkIds(
  results: CancelableResultRow[]
): string[] {
  return results.flatMap((result) => {
    if (
      !result.workId ||
      SCREENING_TERMINAL_RESULT_STATUSES.includes(
        result.status as (typeof SCREENING_TERMINAL_RESULT_STATUSES)[number]
      )
    ) {
      return [];
    }

    return [result.workId];
  });
}
