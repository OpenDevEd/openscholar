/**
 * Plan-07 — currently-processing paper indicator.
 *
 * Returns the in-flight paper for a job (status === "extracting"), or
 * null if no paper is actively being extracted. When multiple papers
 * are in-flight (workpool `maxParallelism > 1`), picks the one that
 * started earliest so the banner does not flicker between siblings
 * on every tick. Indexed via `extractionPapers.by_job_status` — no
 * per-query table scan.
 *
 * Gated on the parent job's status: when the job is paused,
 * credits-exhausted, cancelled, or terminal, the banner must stay
 * silent even if individual paper rows still linger at
 * `status: "extracting"`. Plan-06's pause contract lets the in-flight
 * LLM finish cleanly, so those paper rows briefly outlive the
 * job-level pause — and the UI would otherwise show a spinning
 * "currently extracting" while the job is visibly paused.
 *
 * Caller-safe: returns null for unowned / missing jobs, matching the
 * `queries/costs.ts` caller-safe pattern so no existence leaks reach
 * the client through the query channel.
 */

import { PAPER_LIMIT } from "../../../lib/extraction/limits";
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";
import { RUNNING_JOB_STATUSES } from "../stateMachine";

const nowProcessingResultValidator = v.union(
  v.null(),
  v.object({
    paperId: v.id("extractionPapers"),
    paperTitle: v.string(),
    startedAt: v.optional(v.number()),
  }),
);

export const getNowProcessing = query({
  args: { jobId: v.id("extractionJobs") },
  returns: nowProcessingResultValidator,
  handler: async (ctx, { jobId }) => {
    const owned = await resolveOwnedJob(ctx, jobId);
    if (owned.status !== "ok") return null;

    if (!owned.job.status || !RUNNING_JOB_STATUSES.has(owned.job.status)) {
      return null;
    }

    const inFlight = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "extracting"),
      )
      // A retry can mark every paper of the job extracting at once: up to PAPER_LIMIT.
      .take(PAPER_LIMIT);
    if (inFlight.length === 0) return null;

    // Pick the earliest-started paper so parallel workpool dispatch
    // doesn't cause the banner to flicker between siblings.
    let chosen = inFlight[0];
    for (let i = 1; i < inFlight.length; i++) {
      const candidate = inFlight[i];
      const candidateAt = candidate.startedAt ?? Number.POSITIVE_INFINITY;
      const chosenAt = chosen.startedAt ?? Number.POSITIVE_INFINITY;
      if (candidateAt < chosenAt) chosen = candidate;
    }
    return {
      paperId: chosen._id,
      paperTitle: chosen.title,
      ...(chosen.startedAt !== undefined
        ? { startedAt: chosen.startedAt }
        : {}),
    };
  },
});
