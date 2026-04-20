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
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

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
    "completed",
    "failed",
    "cancelled",
  ],
  downloading_pdfs: [
    "indexing",
    "extracting",
    "creditsExhausted",
    "completed",
    "failed",
    "cancelled",
  ],
  indexing: [
    "extracting",
    "creditsExhausted",
    "completed",
    "failed",
    "cancelled",
  ],
  extracting: ["creditsExhausted", "completed", "failed", "cancelled"],
  // Non-terminal. Outgoing edges are the only legal exits: back to
  // `extracting` via plan 06's resume, or any terminal state (cancel,
  // fail permanently, or final completion if the user cancels remaining
  // and the already-completed papers roll up).
  creditsExhausted: ["extracting", "completed", "cancelled", "failed"],
  // Terminal states: once a job is in one of these, it stays there.
  completed: [],
  failed: [],
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
  // Terminal states.
  completed: [],
  failed: [],
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
