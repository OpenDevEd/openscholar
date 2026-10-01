import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { readShardedCounts, setShardedCounts } from "../screening/resultCounts";

/**
 * Counts each Screen all job saved before #383 into its sharded counters from its results,
 * then marks it counted, so its progress and finish stop reading the aggregates. A job that
 * is still running is recounted in the same transaction as the mark; papers finishing after
 * are counted by the trigger. One job per transaction, safe to run again.
 *
 *   npx convex run migrations/recountScreeningJobs:run '{"dryRun": true}'
 *   npx convex run migrations/recountScreeningJobs:run
 *   npx convex run migrations/recountScreeningJobs:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** A job's counts from its results: at most MAX_SCREENING_PAPERS_PER_JOB rows. */
async function countResults(ctx: Pick<QueryCtx, "db">, jobId: Id<"screeningJobs">) {
  const results = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(MAX_SCREENING_PAPERS_PER_JOB);
  const counts = { completed: 0, skipped: 0, failed: 0, qualified: 0 };
  for (const result of results) {
    if (result.status === "completed" || result.status === "skipped" || result.status === "failed") counts[result.status]++;
    if (result.status === "completed" && result.qualified === true) counts.qualified++;
  }
  return counts;
}

export const recountJobs = migrations.define({
  table: "screeningJobs",
  batchSize: 1,
  migrateOne: async (ctx, job) => {
    if (job.resultCounts === "sharded") return;
    await setShardedCounts(ctx, job._id, await countResults(ctx, job._id));
    return { resultCounts: "sharded" as const };
  },
});

export const run = migrations.runner(internal.migrations.recountScreeningJobs.recountJobs);

/** One job's check: it's counted by shards, and its counters match its results. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ cursor, numItems: 1 });
    const problems: string[] = [];
    for (const job of page.page as Doc<"screeningJobs">[]) {
      if (job.resultCounts !== "sharded") {
        problems.push(`${job._id}: not counted by shards`);
        continue;
      }
      const rows = await countResults(ctx, job._id);
      const kept = await readShardedCounts(ctx, job._id);
      const expected = { completedCount: rows.completed, skippedCount: rows.skipped, failedCount: rows.failed, qualifiedCount: rows.qualified };
      if (JSON.stringify(kept) !== JSON.stringify(expected)) problems.push(`${job._id}: counted ${JSON.stringify(kept)}, results say ${JSON.stringify(expected)}`);
    }
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many jobs aren't counted by shards or count wrong, with the first few; `wrong` is 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ wrong: v.number(), sample: v.array(v.string()) }),
  handler: async (ctx): Promise<{ wrong: number; sample: string[] }> => {
    let wrong = 0;
    const sample: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.recountScreeningJobs.verifyPage, { cursor });
      wrong += page.problems.length;
      sample.push(...page.problems.slice(0, 20 - sample.length));
      if (page.isDone) return { wrong, sample };
      cursor = page.continueCursor;
    }
  },
});
