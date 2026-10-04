/**
 * The worker that folds extraction count changes into each job's counts row (./counts.ts),
 * and finishes jobs whose counts are complete.
 */
import { defineBatchWorkerValidators } from "@convex-dev/batch-worker";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../lib/functions";
import { addInto, countsRow } from "./counts";

/** Changes per batch. */
const BATCH = 200;

const { vQueryArgs, vQueryReturns, vMutationArgs, vMutationReturns } = defineBatchWorkerValidators({
  batch: { changes: v.array(v.id("extractionCountChanges")) },
});

const queuedAtOf = (change: Doc<"extractionCountChanges">) => change.queuedAt as bigint;

/**
 * The next changes, in commit order. The worker deletes the changes it folds, so the
 * queue's index holds only waiting ones, and a scan from the last commit picks up changes
 * appended in it that didn't fit the batch.
 */
export const nextChanges = internalQuery({
  args: vQueryArgs,
  returns: vQueryReturns,
  handler: async (ctx, { cursor }) => {
    const rows = await ctx.db
      .query("extractionCountChanges")
      .withIndex("by_queuedAt", (q) => q.gte("queuedAt", cursor ?? 0n))
      .take(BATCH);
    if (!rows.length) return { kind: "idle" as const };
    return { kind: "work" as const, batch: { changes: rows.map((row) => row._id) }, cursor: queuedAtOf(rows.at(-1)!) };
  },
});

/** Folds a batch of changes into their jobs' counts rows, and finishes jobs whose counts are complete. */
export const fold = internalMutation({
  args: vMutationArgs,
  returns: vMutationReturns,
  handler: async (ctx, { changes: ids }) => {
    const changes = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((change): change is Doc<"extractionCountChanges"> => change !== null);
    const byJob = new Map<Id<"extractionJobs">, Doc<"extractionCountChanges">[]>();
    for (const change of changes) byJob.set(change.jobId, [...(byJob.get(change.jobId) ?? []), change]);
    for (const [jobId, jobChanges] of byJob) {
      const job = await ctx.db.get(jobId);
      if (job) {
        // Every job gets its row when it's made; one whose row is missing starts from nothing.
        const row = (await countsRow(ctx, jobId)) ?? (await ctx.db.get(await ctx.db.insert("extractionJobCounts", { jobId, counts: {} })))!;
        const counts = { ...row.counts };
        for (const change of jobChanges) addInto(counts, change.deltas);
        await ctx.db.patch(row._id, { counts });
        // Out of the queue before the finish check, which waits until a job has none.
        for (const change of jobChanges) await ctx.db.delete(change._id);
        // Source setup establishes the count and handles an empty job itself.
        // Revision-only writes can reach this worker before any papers exist.
        if (job.mode === "extraction" && (job.totalPapers ?? 0) > 0 && (counts.processed ?? 0) + (counts.failed ?? 0) >= job.totalPapers!) {
          await ctx.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
        }
        continue;
      }
      // Its job is gone: out of the queue.
      for (const change of jobChanges) await ctx.db.delete(change._id);
    }
    return null;
  },
});
