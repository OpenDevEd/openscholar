import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countRow, startCount, type Counted } from "../research/recordCounts";
import { shortcutSortName } from "../../lib/query-shortcuts";

/**
 * Readies saved searches and query shortcuts to list a page at a time (#420): each person
 * who has any gets the count row the pages total from, counted a page at a time
 * (research/recordCounts.ts), and each shortcut gets the `sortName` the Bookmarks page orders
 * by. Someone who saves or deletes one first is counted then. Safe to run again.
 *
 *   npx convex run migrations/pagedRecords:run '{"dryRun": true}'
 *   npx convex run migrations/pagedRecords:run
 *   npx convex run migrations/pagedRecords:verify
 *
 * If `verify` stays above 0, a count stopped part way; `resume` carries each on:
 *
 *   npx convex run migrations/pagedRecords:resume
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const prepareSearches = migrations.define({
  table: "searches",
  batchSize: 50,
  migrateOne: async (ctx, search) => {
    await startCount(ctx, "searches", search.userId);
  },
});

export const prepareShortcuts = migrations.define({
  table: "queryShortcuts",
  batchSize: 50,
  migrateOne: async (ctx, shortcut) => {
    await startCount(ctx, "queryShortcuts", shortcut.userId);
    const sortName = shortcutSortName(shortcut.data.shorthand);
    if (shortcut.sortName !== sortName) return { sortName };
  },
});

export const run = migrations.runner([internal.migrations.pagedRecords.prepareSearches, internal.migrations.pagedRecords.prepareShortcuts]);

/** Problems on one page of `table`: an owner with no count or one still being taken, or a shortcut without its sort name. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("searches"), v.literal("queryShortcuts")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = table === "searches"
      ? await ctx.db.query("searches").paginate({ cursor, numItems: 20 })
      : await ctx.db.query("queryShortcuts").paginate({ cursor, numItems: 100 });
    let wrong = page.page.filter((row) => !("localId" in row) && row.sortName !== shortcutSortName(row.data.shorthand)).length;
    for (const userId of new Set(page.page.map((row) => row.userId))) {
      const row = await countRow(ctx, table, userId);
      if (!row || row.countedTo !== undefined) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Carries on every first count that stopped part way; a count still running just takes an extra step. */
export const resume = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor = null }) => {
    const page = await ctx.db.query("recordCounts").paginate({ cursor, numItems: 100 });
    for (const row of page.page) {
      if (row.countedTo !== undefined) await ctx.scheduler.runAfter(0, internal.research.records.countRecordsPage, { table: row.table, userId: row.userId });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.pagedRecords.resume, { cursor: page.continueCursor });
    return null;
  },
});

/** How many problems `verifyPage` finds across every search and shortcut; 0 once every count is taken. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["searches", "queryShortcuts"] satisfies Counted[]) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedRecords.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
