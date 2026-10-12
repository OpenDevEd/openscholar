/**
 * Plan-06 pause mutation.
 *
 * `pauseExtraction(jobId)` is a cooperative pause — it flips the job
 * into status `paused` and captures the phase it was in (so resume can
 * restore it). Queue dispatchers and workers read the paused status
 * before leasing or persisting further work.
 *
 * Idempotent: calling on a non-running status (already paused, terminal,
 * creditsExhausted) returns silently without throwing. All decision
 * logic lives in the pure `validatePauseTransition` helper so the
 * mutation stays a thin transport layer.
 *
 * Design explicitly rejected: pool-level pause via
 * `components.pdfProcessingPool.config.update`. See plan-06 § Approach —
 * the 0.3.2 workpool client doesn't expose that, and even if it did,
 * pausing the pool would leak across all users sharing it.
 */

import { v } from "convex/values";
import { jobIn } from "../access";
import { assistantMutation, defineUserMutation, reversedBy, userMutation } from "../../lib/userActions";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validatePauseTransition } from "../../../lib/extraction/transitions";

export const pauseExtractionAction = defineUserMutation({
  path: "extraction/mutations/pause:pauseExtraction",
  description:
    "Pauses one of the workspace's extractions while it runs: the papers being read finish, and no more start until it's resumed (extraction/mutations/resume:resumeExtraction). Its answers so far stay. One that isn't running is left as it is, and `reason` says why.",
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    paused: v.boolean(),
    reason: v.optional(v.string()),
    undo: reversedBy("extraction/mutations/resume:resumeExtraction", { jobId: v.id("extractionJobs") }),
  }),
  activity: ({ jobId }, { paused }) => (paused ? { kind: "extraction", id: jobId, happened: "paused" } : null),
  run: async (ctx, actor, { jobId }) => {
    const job = await jobIn(ctx, actor, jobId);
    if (!job.status) return { paused: false, reason: "not_running" };

    const decision = validatePauseTransition(job.status as JobStatus);
    if (!decision.ok) return { paused: false, reason: decision.reason };

    assertValidJobTransition(job.status as JobStatus, decision.nextStatus);
    await ctx.db.patch(jobId, {
      status: decision.nextStatus,
      runEpoch: (job.runEpoch ?? 0) + 1,
      pausedAt: Date.now(),
      pausedFromStatus: decision.pausedFrom,
      updatedAt: Date.now(),
    });
    return { paused: true, undo: { path: "extraction/mutations/resume:resumeExtraction" as const, args: { jobId } } };
  },
});
export const pauseExtraction = userMutation(pauseExtractionAction);
export const pauseExtractionForAssistant = assistantMutation(pauseExtractionAction);
