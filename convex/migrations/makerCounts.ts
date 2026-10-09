import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { makerCountRow, startMakerCount, type ByMaker } from "../research/recordCounts";

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
export const screeningJobs = start("screeningJobs");
export const extractionJobs = start("extractionJobs");
export const collections = start("collections");
export const assistantThreads = start("assistantThreads");

export const run = migrations.runner([
  internal.migrations.makerCounts.searches,
  internal.migrations.makerCounts.screeningJobs,
  internal.migrations.makerCounts.extractionJobs,
  internal.migrations.makerCounts.collections,
  internal.migrations.makerCounts.assistantThreads,
]);

const TABLES = ["searches", "screeningJobs", "extractionJobs", "collections", "assistantThreads"] as const;

/** Records on one page of a table, in an organization, whose maker has no finished count. */
export const verifyPage = internalQuery({
  args: { table: v.union(...TABLES.map((table) => v.literal(table))), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 50, maximumBytesRead: 8 * 1024 * 1024 });
    let wrong = 0;
    for (const record of page.page) {
      if ((await ctx.db.get("workspaces", record.workspaceId))?.kind !== "organization") continue;
      const row = await makerCountRow(ctx, table, record.workspaceId, record.createdBy);
      if (!row || row.countedTo !== undefined) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many organization records have a maker whose count isn't kept yet; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.makerCounts.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
