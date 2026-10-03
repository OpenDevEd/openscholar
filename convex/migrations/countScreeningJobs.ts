import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countRow, startCount } from "../research/recordCounts";

/**
 * Gives each person who has screening jobs the count their job history totals its pages from
 * (#421), counted a page at a time (research/recordCounts.ts). Someone who starts a job first
 * is counted then. Safe to run again.
 *
 *   npx convex run migrations/countScreeningJobs:run '{"dryRun": true}'
 *   npx convex run migrations/countScreeningJobs:run
 *   npx convex run migrations/countScreeningJobs:verify
 *
 * If `verify` stays above 0, a count stopped part way; `migrations/pagedRecords:resume`
 * carries on every count that did, whichever table it counts.
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// A small batch: a job's questions and scoring rules have no byte limit of their own.
export const jobs = migrations.define({
  table: "screeningJobs",
  batchSize: 5,
  migrateOne: async (ctx, job) => {
    await startCount(ctx, "screeningJobs", job.userId);
  },
});

export const run = migrations.runner(internal.migrations.countScreeningJobs.jobs);

/** Owners on one page of jobs with no count, or one still being taken. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ cursor, numItems: 200 });
    let wrong = 0;
    for (const userId of new Set(page.page.map((job) => job.userId))) {
      const row = await countRow(ctx, "screeningJobs", userId);
      if (!row || row.countedTo !== undefined) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many job owners, a page at a time, still have no finished count; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.countScreeningJobs.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
