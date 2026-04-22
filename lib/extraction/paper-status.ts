/**
 * Pure rollup from per-question result rows to the paper's terminal
 * status. Consumed by `convex/extraction/mutations/results.ts::finalizePaper`
 * once every per-question workflow step returns.
 *
 * This module is backend-only: it decides whether a paper has reached
 * a terminal state after per-question fan-out.
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

/**
 * Workflow step retry budget. Matches the per-step retry configured on the
 * WorkflowManager in `convex/workflow.ts` — three attempts total before a
 * question's `attemptCount` ticks past the cap and the rollup treats the
 * retryable failure as effectively terminal.
 */
export const MAX_QUESTION_ATTEMPTS = 3;

/**
 * Precedence bucket each question result falls into during the rollup.
 * The paper's final status is chosen by the highest-precedence bucket
 * any of its questions landed in — see `aggregatePaperStatus` below.
 */
type QuestionBucket = "open" | "retryable_failure" | "terminal_failure" | "completed";

function classifyQuestion(r: PaperQuestionInput): QuestionBucket {
  if (r.status === "completed") return "completed";
  if (r.status !== "failed") return "open";
  const code = r.lastError?.code;
  // Conservative default: if the failure was never classified into a
  // taxonomy code we cannot know if it was transient or permanent.
  // Prefer the "could be retried" branch so we don't falsely finalize
  // a paper as complete before the workflow has exhausted its retry
  // budget. Once `attemptCount` hits the cap the failure flips to
  // `terminal_failure` regardless of retryability.
  const retryable = code === undefined ? true : isRetryable[code];
  const maxedOut = (r.attemptCount ?? 0) >= MAX_QUESTION_ATTEMPTS;
  return retryable && !maxedOut ? "retryable_failure" : "terminal_failure";
}

export function aggregatePaperStatus(results: PaperQuestionInput[]): PaperRollupResult {
  if (results.length === 0) {
    return { status: "pending", completedQuestions: 0, failedQuestions: 0 };
  }
  const buckets: Record<QuestionBucket, number> = {
    open: 0,
    retryable_failure: 0,
    terminal_failure: 0,
    completed: 0,
  };
  for (const r of results) {
    buckets[classifyQuestion(r)] += 1;
  }
  const completedQuestions = buckets.completed;
  const failedQuestions = buckets.terminal_failure;

  // Precedence: any open or retryable-failure question keeps the paper
  // active; otherwise all-terminal → failed, otherwise completed.
  if (buckets.open + buckets.retryable_failure > 0) {
    return { status: "extracting", completedQuestions, failedQuestions };
  }
  if (buckets.completed === 0 && buckets.terminal_failure === results.length) {
    return { status: "failed", completedQuestions, failedQuestions };
  }
  return { status: "completed", completedQuestions, failedQuestions };
}
