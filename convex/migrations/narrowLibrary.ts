import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears the person a library row belonged to before workspaces (#650, slice 8): saved papers,
 * collections, their places, removals and counts are their workspace's, and papers and
 * collections keep who made them as `createdBy`. Nothing reads `userId` on them any more; once
 * this reports 0 on every deployment, the field goes from the schema. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowLibrary:run
 *   npx convex run migrations/narrowLibrary:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const cleared = (row: { userId?: unknown }) => (row.userId === undefined ? undefined : { userId: undefined });

// A paper and a removal can be near a document's 1 MiB: five at a time.
export const papers = migrations.define({ table: "libraryItems", batchSize: 5, migrateOne: (_ctx, row) => cleared(row) });
// A removal from before makers were kept takes its person as the removed paper's maker.
export const removals = migrations.define({
  table: "libraryRemovals",
  batchSize: 5,
  migrateOne: (_ctx, row) => (row.userId === undefined ? undefined : { userId: undefined, ...(row.item.createdBy ? {} : { item: { ...row.item, createdBy: row.userId } }) }),
});
export const collections = migrations.define({ table: "collections", batchSize: 25, migrateOne: (_ctx, row) => cleared(row) });
export const places = migrations.define({ table: "libraryItemCollections", batchSize: 200, migrateOne: (_ctx, row) => cleared(row) });
export const libraryCounts = migrations.define({ table: "libraryCounts", migrateOne: (_ctx, row) => cleared(row) });
export const collectionCounts = migrations.define({ table: "collectionCounts", migrateOne: (_ctx, row) => cleared(row) });

export const run = migrations.runner([
  internal.migrations.narrowLibrary.papers,
  internal.migrations.narrowLibrary.removals,
  internal.migrations.narrowLibrary.collections,
  internal.migrations.narrowLibrary.places,
  internal.migrations.narrowLibrary.libraryCounts,
  internal.migrations.narrowLibrary.collectionCounts,
]);

const TABLES = ["libraryItems", "libraryRemovals", "collections", "libraryItemCollections", "libraryCounts", "collectionCounts"] as const;

/** Rows on one page of `table` that still name a person, and removed papers with no maker. */
export const verifyPage = internalQuery({
  args: { table: v.union(...TABLES.map((table) => v.literal(table))), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 });
    const named = page.page.filter((row) => row.userId !== undefined || ("item" in row && row.item.createdBy === undefined));
    return { missing: named.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many library rows still name a person; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowLibrary.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
