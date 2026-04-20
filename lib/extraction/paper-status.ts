/**
 * Pure rollup from per-question result rows to the paper's terminal
 * status. Consumed by `convex/extraction/mutations/results.ts::finalizePaper`
 * once every per-question workflow step returns.
 *
 * Not related to `./question-status.ts`, which is a UI helper for
 * progress-bar status dots. This module is backend-only: it decides
 * whether a paper has reached a terminal state after per-question
 * fan-out.
 *
 * Plan 02 § "TDD sequence".
 */

import { isRetryable, type ErrorCode } from "@/lib/errors/taxonomy";

export type PaperQuestionRollupStatus = "pending" | "extracting" | "completed" | "failed";

export type PaperQuestionInput = {
  status: PaperQuestionRollupStatus;
  lastError?: { code?: ErrorCode };
  attemptCount?: number;
};

export type PaperRollupResult = {
  status: PaperQuestionRollupStatus;
  completedQuestions: number;
  failedQuestions: number;
};

export function aggregatePaperStatus(results: PaperQuestionInput[]): PaperRollupResult {
  if (results.length === 0) {
    return { status: "pending", completedQuestions: 0, failedQuestions: 0 };
  }
  const completedQuestions = results.filter((r) => r.status === "completed").length;
  return { status: "completed", completedQuestions, failedQuestions: 0 };
}
