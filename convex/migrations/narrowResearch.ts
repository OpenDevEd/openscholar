import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears the person a research row belonged to before workspaces (#650, slice 8): searches,
 * bookmarks, their counts, screenings and search history are their workspace's, and a search
 * revision keeps who made it as `createdBy`. Nothing reads `userId` on them any more; once this
 * reports 0 on every deployment, the field goes from the schema. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowResearch:run
 *   npx convex run migrations/narrowResearch:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const cleared = (row: { userId?: unknown }) => (row.userId === undefined ? undefined : { userId: undefined });

// A search and a revision can be near a document's 1 MiB: five at a time.
export const searches = migrations.define({ table: "searches", batchSize: 5, migrateOne: (_ctx, row) => cleared(row) });
export const revisions = migrations.define({
  table: "searchRevisions",
  batchSize: 5,
  migrateOne: (_ctx, row) => (row.userId === undefined ? undefined : { userId: undefined, ...(row.createdBy ? {} : { createdBy: row.userId }) }),
});
// A bookmark's expansion and a history entry's text have no byte cap of their own: small batches.
export const shortcuts = migrations.define({ table: "queryShortcuts", batchSize: 20, migrateOne: (_ctx, row) => cleared(row) });
export const counts = migrations.define({ table: "recordCounts", migrateOne: (_ctx, row) => cleared(row) });
export const screenings = migrations.define({ table: "screenings", batchSize: 25, migrateOne: (_ctx, row) => cleared(row) });
export const history = migrations.define({ table: "searchHistory", batchSize: 50, migrateOne: (_ctx, row) => cleared(row) });

export const run = migrations.runner([
  internal.migrations.narrowResearch.searches,
  internal.migrations.narrowResearch.revisions,
  internal.migrations.narrowResearch.shortcuts,
  internal.migrations.narrowResearch.counts,
  internal.migrations.narrowResearch.screenings,
  internal.migrations.narrowResearch.history,
]);

const TABLES = ["searches", "searchRevisions", "queryShortcuts", "recordCounts", "screenings", "searchHistory"] as const;

/** Rows on one page of `table` that still name a person. */
export const verifyPage = internalQuery({
  args: { table: v.union(...TABLES.map((table) => v.literal(table))), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 });
    return { missing: page.page.filter((row) => row.userId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many research rows still name a person; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowResearch.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
