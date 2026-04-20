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
  if (TERMINAL_JOB_STATUSES.has(currentStatus)) {
    return { ok: false, reason: "terminal" };
  }
  return { ok: true, nextStatus: "paused", pausedFrom: currentStatus };
}
