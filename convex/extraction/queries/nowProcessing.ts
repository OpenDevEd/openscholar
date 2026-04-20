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
 * Caller-safe: returns null for unowned / missing jobs, matching the
 * `queries/costs.ts` caller-safe pattern so no existence leaks reach
 * the client through the query channel.
 */

import { query } from "../../_generated/server";
import { v } from "convex/values";
import { resolveOwnedJob } from "../access";

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

    const inFlight = await ctx.db
      .query("extractionPapers")
      .withIndex("by_job_status", (q) =>
        q.eq("jobId", jobId).eq("status", "extracting"),
      )
      .collect();
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
