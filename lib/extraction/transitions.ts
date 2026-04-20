/**
 * Pause / resume transition validators for extraction jobs.
 *
 * Pure decision functions that the pause / resume mutations wrap. The
 * mutations themselves stay thin — this file owns the rules about which
 * statuses can be paused, which can resume, and whether the post-resume
 * credit pre-flight is satisfied.
 */

import {
  TERMINAL_JOB_STATUSES,
  isRunningJobStatus,
  type JobStatus,
  type RunningJobStatus,
} from "@/convex/extraction/stateMachine";

export type PauseTransitionResult =
  | { ok: true; nextStatus: "paused"; pausedFrom: RunningJobStatus }
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
  if (!isRunningJobStatus(currentStatus)) {
    // Unreachable — the three guards above enumerate every non-running
    // JobStatus. Keeps the type narrow on the happy return so pause
    // mutations can persist `pausedFrom` into the narrowed schema column
    // without a cast.
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

  if (currentStatus !== "paused" && currentStatus !== "creditsExhausted") {
    return { ok: false, reason: "not_paused" };
  }

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
