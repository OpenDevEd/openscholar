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
import { legacyCounts } from "./legacyCounts";

/** Changes per batch; a batch starts at most one job's counts row. */
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
    let started = false;
    const waiting: bigint[] = [];
    for (const [jobId, jobChanges] of byJob) {
      const job = await ctx.db.get(jobId);
      if (job) {
        let row = await countsRow(ctx, jobId);
        if (!row) {
          // A job saved before its counts row starts from the old counters, which stopped at
          // the deploy; every change since is in the log. Reading them touches every shard, so
          // a batch starts one job's row and the others' changes wait for the next batch.
          if (started) {
            waiting.push(...jobChanges.map(queuedAtOf));
            continue;
          }
          started = true;
          const id = await ctx.db.insert("extractionJobCounts", { jobId, counts: await legacyCounts(ctx, jobId) });
          row = (await ctx.db.get(id))!;
        }
        const counts = { ...row.counts };
        for (const change of jobChanges) addInto(counts, change.deltas);
        await ctx.db.patch(row._id, { counts });
        // Out of the queue before the finish check, which waits until a job has none.
        for (const change of jobChanges) await ctx.db.delete(change._id);
        if ((counts.processed ?? 0) + (counts.failed ?? 0) >= (job.totalPapers ?? 0)) {
          await ctx.runMutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
        }
        continue;
      }
      // Its job is gone: out of the queue.
      for (const change of jobChanges) await ctx.db.delete(change._id);
    }
    if (waiting.length) return { cursor: waiting.reduce((min, ts) => (ts < min ? ts : min)) };
    return null;
  },
});

