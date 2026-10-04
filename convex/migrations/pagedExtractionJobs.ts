import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { collectionSortName } from "../library/sortName";
import { countRow, startCount } from "../research/recordCounts";

/**
 * Gets extraction jobs from before their list paged ready for it (#422): each job gets the
 * name its list sorts by, and each owner the count the list totals its pages from, counted
 * a page at a time (research/recordCounts.ts). A job made or renamed since has its sort name
 * from a trigger, and someone who makes a job first is counted then. Safe to run again.
 *
 *   npx convex run migrations/pagedExtractionJobs:run '{"dryRun": true}'
 *   npx convex run migrations/pagedExtractionJobs:run
 *   npx convex run migrations/pagedExtractionJobs:verify
 *
 * If `verify` stays above 0, a count stopped part way; `migrations/pagedRecords:resume`
 * carries on every count that did, whichever table it counts.
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// A small batch: a job holds its questions and its sources' summary, with no byte limit of their own.
export const jobs = migrations.define({
  table: "extractionJobs",
  batchSize: 5,
  migrateOne: async (ctx, job) => {
    await startCount(ctx, "extractionJobs", job.userId);
    const sortName = collectionSortName(job.name);
    if (job.sortName !== sortName) return { sortName };
  },
});

export const run = migrations.runner(internal.migrations.pagedExtractionJobs.jobs);

/** Jobs on one page without their sort name, and their owners with no count or one still being taken. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("extractionJobs").paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    let wrong = page.page.filter((job) => job.sortName !== collectionSortName(job.name)).length;
    for (const userId of new Set(page.page.map((job) => job.userId))) {
      const row = await countRow(ctx, "extractionJobs", userId);
      if (!row || row.countedTo !== undefined) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many jobs lack their sort name, plus owners, a page at a time, without a finished count; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedExtractionJobs.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
