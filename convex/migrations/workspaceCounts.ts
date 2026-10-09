import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countRow, startCount } from "../research/recordCounts";
import { workspaceOf } from "../workspaces/personal";

/**
 * Counts every workspace's searches, shortcuts and jobs afresh once counts are kept by
 * workspace (#650): a count from before was its person's, whatever workspace each record was
 * in. `restart` takes every count back to a first count by workspace, a page at a time
 * (research/recordCounts.ts); the table steps start one for a workspace that has records and
 * no count yet. Running it again counts again.
 *
 *   npx convex run migrations/workspaceCounts:run
 *   npx convex run migrations/workspaceCounts:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const restart = migrations.define({
  table: "recordCounts",
  migrateOne: async (ctx, row) => {
    await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table: row.table, workspaceId: await workspaceOf(ctx, row) });
    return { count: 0, countedTo: 0 };
  },
});

// A search or job can be near a document's 1 MiB: five at a time, as the backfills do.
export const searches = migrations.define({ table: "searches", batchSize: 5, migrateOne: async (ctx, row) => void (await startCount(ctx, "searches", row)) });
export const shortcuts = migrations.define({ table: "queryShortcuts", batchSize: 5, migrateOne: async (ctx, row) => void (await startCount(ctx, "queryShortcuts", row)) });
export const screeningJobs = migrations.define({ table: "screeningJobs", batchSize: 5, migrateOne: async (ctx, row) => void (await startCount(ctx, "screeningJobs", row)) });
export const extractionJobs = migrations.define({ table: "extractionJobs", batchSize: 5, migrateOne: async (ctx, row) => void (await startCount(ctx, "extractionJobs", row)) });

export const run = migrations.runner([
  internal.migrations.workspaceCounts.restart,
  internal.migrations.workspaceCounts.searches,
  internal.migrations.workspaceCounts.shortcuts,
  internal.migrations.workspaceCounts.screeningJobs,
  internal.migrations.workspaceCounts.extractionJobs,
]);

const TABLES = ["searches", "queryShortcuts", "screeningJobs", "extractionJobs"] as const;

/** Workspaces on one page of `table` with no finished count. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("searches"), v.literal("queryShortcuts"), v.literal("screeningJobs"), v.literal("extractionJobs")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    let missing = 0;
    for (const workspaceId of new Set(await Promise.all(page.page.map((row) => workspaceOf(ctx, row))))) {
      const row = await countRow(ctx, table, workspaceId);
      if (!row || row.countedTo !== undefined) missing++;
    }
    return { missing, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many workspaces have records and no finished count; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.workspaceCounts.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
