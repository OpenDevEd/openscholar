import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countedItem, uncountedFacets } from "../library/facets";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Puts every saved paper, collection, removal and library count from before workspaces (#650,
 * slice 3) in its person's own workspace, and records papers and collections as theirs. A
 * paper given its workspace is counted under it by its trigger (library/facets.ts). New rows
 * carry both from the start, and running this again changes nothing. Reads move off `userId`
 * once `verify` says 0.
 *
 *   npx convex run migrations/libraryWorkspaces:run
 *   npx convex run migrations/libraryWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const own = (ctx: MutationCtx, userId: Id<"users">) => ensureWorkspace(ctx, { kind: "personal", userId });

// A paper, and the paper a removal keeps, can be near a document's 1 MiB, and patching one reads it
// again and counts it under its workspace: five at a time, as migrations/researchWorkspaces.ts does.
export const papers = migrations.define({
  table: "libraryItems",
  batchSize: 5,
  migrateOne: async (ctx, item) => (item.workspaceId ? undefined : { workspaceId: await own(ctx, item.userId), createdBy: item.userId }),
});

export const collections = migrations.define({
  table: "collections",
  migrateOne: async (ctx, collection) => (collection.workspaceId ? undefined : { workspaceId: await own(ctx, collection.userId), createdBy: collection.userId }),
});

export const removals = migrations.define({
  table: "libraryRemovals",
  batchSize: 5,
  migrateOne: async (ctx, removal) => (removal.workspaceId ? undefined : { workspaceId: await own(ctx, removal.userId) }),
});

export const libraryCounts = migrations.define({
  table: "libraryCounts",
  migrateOne: async (ctx, row) => (row.workspaceId ? undefined : { workspaceId: await own(ctx, row.userId) }),
});

export const collectionCounts = migrations.define({
  table: "collectionCounts",
  migrateOne: async (ctx, row) => (row.workspaceId ? undefined : { workspaceId: await own(ctx, row.userId) }),
});

export const run = migrations.runner([
  internal.migrations.libraryWorkspaces.papers,
  internal.migrations.libraryWorkspaces.collections,
  internal.migrations.libraryWorkspaces.removals,
  internal.migrations.libraryWorkspaces.libraryCounts,
  internal.migrations.libraryWorkspaces.collectionCounts,
]);

const TABLES = ["libraryItems", "collections", "libraryRemovals", "libraryCounts", "collectionCounts"] as const;
const tableValidator = v.union(v.literal("libraryItems"), v.literal("collections"), v.literal("libraryRemovals"), v.literal("libraryCounts"), v.literal("collectionCounts"));

/** Rows on one page of `table` with no workspace or maker yet, and papers not counted under their workspace. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "libraryItems") {
      const page = await ctx.db.query("libraryItems").paginate(opts);
      const unowned = page.page.filter((item) => !item.workspaceId || !item.createdBy).length;
      const uncounted = await uncountedFacets(ctx, page.page.map((item) => ({ id: item._id, row: countedItem(item) })));
      return { missing: unowned + uncounted, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    if (table === "collections") {
      const page = await ctx.db.query("collections").paginate(opts);
      return { missing: page.page.filter((row) => !row.workspaceId || !row.createdBy).length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query(table).paginate(opts);
    return { missing: page.page.filter((row) => !row.workspaceId).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many library rows have no workspace, or papers no counts under it; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.libraryWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
