import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { startMakerCount, type ByMaker } from "../research/recordCounts";

/**
 * Starts each member's counts of what they made in an organization (#656), for the records made
 * before the triggers kept them: a list's Run by shows them. Each count is taken a page at a
 * time by the step it schedules, as a workspace's first count is; a count already kept stays.
 *
 *   npx convex run migrations/makerCounts:run
 *   npx convex run migrations/makerCounts:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const start = (table: ByMaker) =>
  migrations.define({
    table,
    // A search holds its whole query and history: 25 of the largest stay well within a transaction's reads.
    batchSize: 25,
    migrateOne: async (ctx, record) => startMakerCount(ctx, table, record),
  });

export const searches = start("searches");
export const queryShortcuts = start("queryShortcuts");
export const screeningJobs = start("screeningJobs");
export const extractionJobs = start("extractionJobs");
export const collections = start("collections");
export const assistantThreads = start("assistantThreads");

export const run = migrations.runner([
  internal.migrations.makerCounts.searches,
  internal.migrations.makerCounts.queryShortcuts,
  internal.migrations.makerCounts.screeningJobs,
  internal.migrations.makerCounts.extractionJobs,
  internal.migrations.makerCounts.collections,
  internal.migrations.makerCounts.assistantThreads,
]);

/** Members' counts still being taken, a page of count rows at a time: they're small, so a page reads many. */
export const countingPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ counting: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("recordCounts").paginate({ cursor, numItems: 1000, maximumBytesRead: 4 * 1024 * 1024 });
    return { counting: page.page.filter((row) => row.createdBy && row.countedTo !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * How much is left: the migrations not yet done, and the members' counts they started still being
 * taken; 0 when done. It reads the migrations' own record and the count rows, not the records.
 */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const statuses = await migrations.getStatus(ctx, { migrations: [internal.migrations.makerCounts.searches, internal.migrations.makerCounts.queryShortcuts, internal.migrations.makerCounts.screeningJobs, internal.migrations.makerCounts.extractionJobs, internal.migrations.makerCounts.collections, internal.migrations.makerCounts.assistantThreads] });
    let left = statuses.filter((status) => !status.isDone).length;
    for (let cursor: string | null = null; ;) {
      const page: { counting: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.makerCounts.countingPage, { cursor });
      left += page.counting;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return left;
  },
});
