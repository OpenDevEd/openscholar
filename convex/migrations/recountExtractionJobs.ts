import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { readJobCounters, setJobCounters } from "../extraction/jobCounters";
import { bucketsOf, readPaperErrorCounts, readResultCounts, setPaperErrorCounts, setResultCounts } from "../extraction/resultCounts";
import { isTerminalPaperStatus } from "../extraction/paperLifecycle";
import { PAPER_LIMIT } from "../../lib/extraction/limits";

const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/**
 * Most result and paper error rows one job's recount reads: with its papers, about 13 MB
 * of the 16 MiB a transaction may read.
 */
const RECOUNT_MAX_ROWS = 10_000;

async function readAll<T>(rows: { take(n: number): Promise<T[]> }, jobId: Id<"extractionJobs">, limit: number) {
  const all = await rows.take(limit + 1);
  if (all.length > limit) throw new Error(`Job ${jobId} has more than ${limit} rows of one kind, more than one transaction can recount`);
  return all;
}

/** Every count a job's counters should hold, recounted from its rows. */
async function countJob(ctx: Pick<QueryCtx, "db">, jobId: Id<"extractionJobs">) {
  const jobs = { processed: 0, failed: 0 };
  for (const paper of await readAll(ctx.db.query("extractionPapers").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, PAPER_LIMIT)) {
    if (paper.processable === false || !isTerminalPaperStatus(paper.status)) continue;
    if (paper.status === "completed") jobs.processed++;
    else jobs.failed++;
  }
  const results = new Map<string, number>();
  for (const result of await readAll(ctx.db.query("extractionResults").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, RECOUNT_MAX_ROWS)) {
    for (const bucket of bucketsOf(result)) results.set(bucket, (results.get(bucket) ?? 0) + 1);
  }
  const errors = new Map<string, number>();
  for (const error of await readAll(ctx.db.query("extractionPaperErrors").withIndex("by_job", (q) => q.eq("jobId", jobId)), jobId, RECOUNT_MAX_ROWS)) {
    errors.set(error.code, (errors.get(error.code) ?? 0) + 1);
  }
  return { jobs, results, errors };
}

/**
 * Sets every job's paper, result and paper error counters to a recount of its rows (#351),
 * for jobs saved before the counters were kept by triggers. Each job recounts in one
 * transaction, so a row written meanwhile is counted exactly once, by the recount or by
 * its trigger. Safe to run again.
 *
 * ponytail: one job per transaction, up to RECOUNT_MAX_ROWS results; a larger job fails
 * the run by name. Extraction data only exists on dev (the largest job on shared dev has
 * 1,018 results, 2026-09-30). Recounting a larger job over several transactions would
 * need its writes paused, or rows written between pages would be counted twice.
 *
 *   npx convex run migrations/recountExtractionJobs:run '{"dryRun": true}'
 *   npx convex run migrations/recountExtractionJobs:run
 *   npx convex run migrations/recountExtractionJobs:verify
 */
export const recount = migrations.define({
  table: "extractionJobs",
  batchSize: 1,
  migrateOne: async (ctx, job) => {
    const { jobs, results, errors } = await countJob(ctx, job._id);
    await setJobCounters(ctx, job._id, jobs);
    await setResultCounts(ctx, job._id, results);
    await setPaperErrorCounts(ctx, job._id, errors);
  },
});

export const run = migrations.runner(internal.migrations.recountExtractionJobs.recount);

/** Jobs whose counters don't match a recount of their rows; empty when every count holds. */
export const verify = internalQuery({
  args: { paginationOpts: v.object({ cursor: v.union(v.string(), v.null()), numItems: v.number() }) },
  returns: v.object({ mismatches: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("extractionJobs").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 1) });
    const mismatches: string[] = [];
    for (const job of page.page) {
      const expected = await countJob(ctx, job._id);
      const [jobs, results, errors] = await Promise.all([readJobCounters(ctx, job._id), readResultCounts(ctx, job._id), readPaperErrorCounts(ctx, job._id)]);
      const want = {
        jobs: expected.jobs,
        total: expected.results.get("total") ?? 0,
        completed: expected.results.get("completed") ?? 0,
        retryable: expected.results.get("retryable") ?? 0,
        permanent: Object.fromEntries([...expected.results].filter(([bucket]) => bucket.startsWith("permanent:")).map(([bucket, n]) => [bucket.slice("permanent:".length), n])),
        errors: Object.fromEntries(expected.errors),
      };
      const have = { jobs, total: results.total, completed: results.completed, retryable: results.retryable, permanent: results.permanent, errors };
      const sorted = (value: object) => JSON.stringify(value, (_, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort()) : inner));
      if (sorted(want) !== sorted(have)) mismatches.push(`${job._id}: counters ${sorted(have)}, rows ${sorted(want)}`);
    }
    return { mismatches, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
