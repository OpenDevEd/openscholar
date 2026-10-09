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

import { mutation } from "../../lib/functions";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { createError } from "../../lib/errors";
import { assertJobAccess } from "../access";
import {
  assertValidJobTransition,
  type JobStatus,
} from "../stateMachine";
import { validatePauseTransition } from "../../../lib/extraction/transitions";
import { noteActivity } from "../../activity/notes";

export const pauseExtraction = mutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.object({
    paused: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { jobId }): Promise<{
    paused: boolean;
    reason?: string;
  }> => {
    const user = await requireAuth(ctx);
    const { job } = await assertJobAccess(ctx, user, jobId);

    if (!job.status) {
      // Chat rows and freshly-created extraction rows before startJob
      // writes a status — nothing to pause.
      return { paused: false, reason: "not_running" };
    }

    const decision = validatePauseTransition(job.status as JobStatus);
    if (!decision.ok) {
      return { paused: false, reason: decision.reason };
    }

    assertValidJobTransition(job.status as JobStatus, decision.nextStatus);
    await ctx.db.patch(jobId, {
      status: decision.nextStatus,
      runEpoch: (job.runEpoch ?? 0) + 1,
      pausedAt: Date.now(),
      pausedFromStatus: decision.pausedFrom,
      updatedAt: Date.now(),
    });
    await noteActivity(ctx, { workspaceId: job.workspaceId, by: user._id, viaAssistant: false }, { kind: "extraction", id: jobId, happened: "paused" });

    return { paused: true };
  },
});
