/**
 * State-machine guards for extraction job + paper status transitions.
 *
 * Every `ctx.db.patch(..., { status })` on extractionJobs / extractionPapers
 * goes through one of these assertions (either directly, or transitively
 * via updateJobStatus / updatePaperStatus / markPaperTerminalTx in
 * mutations.ts).
 *
 * Terminal-state stickiness (no transition out of cancelled / failed /
 * completed) is already enforced upstream; these guards add defensive
 * validation so a new code path cannot silently introduce an illegal
 * transition like `cancelled → running` or `completed → failed`.
 */

import { createError } from "../lib/errors";

export const JOB_STATUSES = [
  "pending",
  "downloading_pdfs",
  "indexing",
  "extracting",
  // Non-terminal (plan 03). The per-question worker detects insufficient
  // credits mid-run, transitions the job here, and stops dispatching.
  // Plan 06 adds the resume mutation that transitions back to `extracting`.
  "creditsExhausted",
  // Non-terminal user-initiated pause (plan 06). The workflow's gate
  // step.awaitEvent holds new dispatches until resume fires sendEvent.
  // The pausedFromStatus column captures the phase to resume to.
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Running/active job statuses. These are the states a pause mutation
 * accepts as input (everything else is either already paused, credits-
 * exhausted, or terminal). Source of truth for the pause-eligibility
 * predicate in `lib/extraction/transitions.ts`.
 *
 * The array form is kept alongside the Set so callers can derive the
 * narrowed `RunningJobStatus` type — the Set by itself can't narrow.
 */
export const RUNNING_JOB_STATUSES_LIST = [
  "pending",
  "downloading_pdfs",
  "indexing",
  "extracting",
] as const satisfies readonly JobStatus[];

export type RunningJobStatus = (typeof RUNNING_JOB_STATUSES_LIST)[number];

export const RUNNING_JOB_STATUSES = new Set<JobStatus>(RUNNING_JOB_STATUSES_LIST);

export function isRunningJobStatus(
  status: JobStatus,
): status is RunningJobStatus {
  return (RUNNING_JOB_STATUSES_LIST as readonly JobStatus[]).includes(status);
}

/**
 * Terminal job statuses. Once a job lands here, only plan-05's retry
 * re-opens the completed/failed pair; cancelled is sticky.
 */
export const TERMINAL_JOB_STATUSES = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Source of truth for job transitions. Derived from the workflow
 * orchestration in convex/extraction/workflow.ts + finalize /
 * cancel paths in mutations.ts.
 *
 * The workflow can skip directly from `pending` into any active phase
 * when a prior phase is a no-op (e.g. PDF-disabled jobs go
 * pending → indexing). `maybeFinalizeJob` can short-circuit a job with
 * zero processable papers directly to `failed`.
 */
const VALID_JOB_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: [
    "downloading_pdfs",
    "indexing",
    "extracting",
    "creditsExhausted",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ],
  downloading_pdfs: [
    "indexing",
    "extracting",
    "creditsExhausted",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ],
  indexing: [
    "extracting",
    "creditsExhausted",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ],
  extracting: [
    "creditsExhausted",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ],
  // Non-terminal. Outgoing edges are the only legal exits: back to
  // `extracting` via plan 06's resume, or any terminal state (cancel,
  // fail permanently, or final completion if the user cancels remaining
  // and the already-completed papers roll up).
  creditsExhausted: ["extracting", "completed", "cancelled", "failed"],
  // Non-terminal user-initiated pause (plan 06). Resume restores the
  // phase captured in `pausedFromStatus`; cancel is the only other exit
  // while paused. No transition to `creditsExhausted` from paused — the
  // mid-run credit detector only fires during active phases, not while
  // the workflow is blocked on awaitEvent.
  paused: [
    "pending",
    "downloading_pdfs",
    "indexing",
    "extracting",
    "cancelled",
    "failed",
  ],
  // Plan-05 retry un-terminals these two. The user can re-open a
  // completed-with-failures or fully-failed job via
  // `retryFailedQuestions`, which flips status back to `extracting` to
  // re-run only the retryable failed questions. Cancelled stays
  // terminal — a cancelled job is reopened via Duplicate, not Retry.
  completed: ["extracting"],
  failed: ["extracting"],
  cancelled: [],
};

export function assertValidJobTransition(from: JobStatus, to: JobStatus): void {
  if (from === to) return;
  if (!VALID_JOB_TRANSITIONS[from].includes(to)) {
    throw createError(
      "VALIDATION_ERROR",
      `invalid job status transition: ${from} → ${to}`,
    );
  }
}

export const PAPER_STATUSES = [
  "pending",
  "downloading",
  "download_failed",
  "indexing",
  "indexing_failed",
  "extracting",
  "completed",
  "failed",
] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

/**
 * Source of truth for paper transitions. The happy path is
 *   pending → downloading → indexing → extracting → completed
 * but an active-state paper can short-circuit into any terminal state
 * at any step (e.g. a late download_failed callback after an
 * extracting start). The invariant this guard enforces is only that a
 * paper in a terminal state never transitions out of it.
 */
const ACTIVE_PAPER_STATUSES = [
  "pending",
  "downloading",
  "indexing",
  "extracting",
] as const satisfies readonly PaperStatus[];

const TERMINAL_PAPER_STATUSES = [
  "completed",
  "failed",
  "download_failed",
  "indexing_failed",
] as const satisfies readonly PaperStatus[];

const ACTIVE_OR_TERMINAL_PAPER_STATUSES: readonly PaperStatus[] = [
  ...ACTIVE_PAPER_STATUSES,
  ...TERMINAL_PAPER_STATUSES,
];

const VALID_PAPER_TRANSITIONS: Record<PaperStatus, readonly PaperStatus[]> = {
  pending: ACTIVE_OR_TERMINAL_PAPER_STATUSES,
  downloading: ACTIVE_OR_TERMINAL_PAPER_STATUSES,
  indexing: ACTIVE_OR_TERMINAL_PAPER_STATUSES,
  extracting: ACTIVE_OR_TERMINAL_PAPER_STATUSES,
  // Plan-05 retry un-terminals these. A paper that carried failed-but-
  // retryable questions (completed-with-failed-questions or fully-failed)
  // is flipped back to `extracting` when the user hits Retry so
  // `finalizePaper` can re-trigger the rollup after the retry wave.
  // download_failed and indexing_failed are paper-level permanent
  // outcomes (no retry at question granularity rescues them).
  completed: ["extracting"],
  failed: ["extracting"],
  download_failed: [],
  indexing_failed: [],
};

export function assertValidPaperTransition(
  from: PaperStatus,
  to: PaperStatus,
): void {
  if (from === to) return;
  if (!VALID_PAPER_TRANSITIONS[from].includes(to)) {
    throw createError(
      "VALIDATION_ERROR",
      `invalid paper status transition: ${from} → ${to}`,
    );
  }
}
