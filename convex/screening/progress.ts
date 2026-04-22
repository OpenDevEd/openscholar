import type { Doc } from "../_generated/dataModel";
import { isTerminalScreeningJobStatus } from "./lifecycle";

export type ScreeningProgressSnapshot = {
  status: Doc<"screeningJobs">["status"];
  totalPapers: number;
  processedPapers: number;
  failedPapers: number;
  qualifiedPapers: number;
  percentComplete: number;
};

export type ScreeningProgressCounts = {
  status: Doc<"screeningJobs">["status"];
  totalPapers: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  qualifiedCount: number;
};

export function buildScreeningProgressSnapshot(
  counts: ScreeningProgressCounts,
): ScreeningProgressSnapshot {
  const processedPapers = counts.completedCount + counts.skippedCount;
  const failedPapers = counts.failedCount;
  const handledPapers = processedPapers + failedPapers;
  const rawPercent =
    counts.totalPapers === 0
      ? 0
      : Math.floor((handledPapers / counts.totalPapers) * 100);

  return {
    status: counts.status,
    totalPapers: counts.totalPapers,
    processedPapers,
    failedPapers,
    qualifiedPapers: counts.qualifiedCount,
    percentComplete: isTerminalScreeningJobStatus(counts.status)
      ? 100
      : Math.min(rawPercent, 99),
  };
}
