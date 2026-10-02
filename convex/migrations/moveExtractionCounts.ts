import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { addInto, countsRow, recountJob, startingCounts, type Counts } from "../extraction/counts";

/**
 * Gives every extraction job saved before its counts moved to a counts row (#400) that row:
 * a recount of its rows, less the count changes still waiting for the worker, which adds
 * them. A job the worker already reached has a row. One job per transaction, safe to run
 * again. Extraction data only exists on dev deployments.
 *
 *   npx convex run migrations/moveExtractionCounts:run '{"dryRun": true}'
 *   npx convex run migrations/moveExtractionCounts:run
 *   npx convex run migrations/moveExtractionCounts:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const moveCounts = migrations.define({
  table: "extractionJobs",
  batchSize: 1,
  migrateOne: async (ctx, job) => {
    if (await countsRow(ctx, job._id)) return;
    await ctx.db.insert("extractionJobCounts", { jobId: job._id, counts: await startingCounts(ctx, job._id) });
  },
});

export const run = migrations.runner(internal.migrations.moveExtractionCounts.moveCounts);

const nonZero = (counts: Counts) => JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0).sort()));

/** One job's check: it has a counts row, and the row plus its waiting changes matches a recount of its rows. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("extractionJobs").paginate({ cursor, numItems: 1 });
    const problems: string[] = [];
    for (const job of page.page) {
      const row = await countsRow(ctx, job._id);
      if (!row) {
        problems.push(`${job._id}: no counts row`);
        continue;
      }
      const kept = { ...row.counts };
      for (const change of await ctx.db.query("extractionCountChanges").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(10_000)) addInto(kept, change.deltas);
      const expected = await recountJob(ctx, job._id);
      if (nonZero(kept) !== nonZero(expected)) problems.push(`${job._id}: counted ${nonZero(kept)}, rows say ${nonZero(expected)}`);
    }
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many jobs have no counts row or count wrong, with the first few; `wrong` is 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ wrong: v.number(), sample: v.array(v.string()) }),
  handler: async (ctx): Promise<{ wrong: number; sample: string[] }> => {
    let wrong = 0;
    const sample: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveExtractionCounts.verifyPage, { cursor });
      wrong += page.problems.length;
      sample.push(...page.problems.slice(0, 20 - sample.length));
      if (page.isDone) return { wrong, sample };
      cursor = page.continueCursor;
    }
  },
});
