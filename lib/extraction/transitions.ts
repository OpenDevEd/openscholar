/**
 * Pause / resume transition validators for extraction jobs.
 *
 * Pure decision functions that the pause / resume mutations wrap. The
 * mutations themselves stay thin — this file owns the rules about which
 * statuses can be paused, which can resume, and whether the post-resume
 * credit pre-flight is satisfied.
 */

import type { JobStatus } from "@/convex/extraction/stateMachine";

export type PauseTransitionResult =
  | { ok: true; nextStatus: "paused"; pausedFrom: JobStatus }
  | { ok: false; reason: "already_paused" | "terminal" | "credits_exhausted" };

export type ResumeTransitionResult =
  | { ok: true; nextStatus: JobStatus }
  | { ok: false; reason: "not_paused" }
  | {
      ok: false;
      reason: "insufficient_credits";
      needed: number;
      available: number;
    };

const TERMINAL_JOB_STATUSES = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function validatePauseTransition(
  currentStatus: JobStatus,
): PauseTransitionResult {
  if (currentStatus === "paused") {
    return { ok: false, reason: "already_paused" };
  }
  if (currentStatus === "creditsExhausted") {
    return { ok: false, reason: "credits_exhausted" };
  }
  if (TERMINAL_JOB_STATUSES.has(currentStatus)) {
    return { ok: false, reason: "terminal" };
  }
  return { ok: true, nextStatus: "paused", pausedFrom: currentStatus };
}

export function validateResumeTransition(args: {
  currentStatus: JobStatus;
  pausedFromStatus?: JobStatus;
  availableCredits: number;
  remainingEstimate: number;
}): ResumeTransitionResult {
  const { currentStatus, pausedFromStatus, availableCredits, remainingEstimate } =
    args;

  if (
    currentStatus === "creditsExhausted" &&
    availableCredits < remainingEstimate
  ) {
    return {
      ok: false,
      reason: "insufficient_credits",
      needed: remainingEstimate,
      available: availableCredits,
    };
  }

  return { ok: true, nextStatus: pausedFromStatus ?? "extracting" };
}
