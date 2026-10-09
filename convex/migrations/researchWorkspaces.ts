import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Puts every saved search and bookmark from before workspaces (#650, slice 2) in its maker's
 * own workspace, and records them as their maker's. New ones carry both from the start, and
 * running this again changes nothing. Reads move off `userId` once `verify` says 0.
 *
 *   npx convex run migrations/researchWorkspaces:run
 *   npx convex run migrations/researchWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** What a row from before takes on: its maker's own workspace, and its maker. */
const owned = async (ctx: MutationCtx, userId: Id<"users">) => ({ workspaceId: await ensureWorkspace(ctx, { kind: "personal", userId }), createdBy: userId });

// A search or bookmark can be large, and the triggers read each patched row again: five at a time, as migrations/searchText.ts does.
export const searches = migrations.define({
  table: "searches",
  batchSize: 5,
  migrateOne: async (ctx, search) => (search.workspaceId ? undefined : await owned(ctx, search.userId)),
});

export const bookmarks = migrations.define({
  table: "queryShortcuts",
  batchSize: 5,
  migrateOne: async (ctx, bookmark) => (bookmark.workspaceId ? undefined : await owned(ctx, bookmark.userId)),
});

export const run = migrations.runner([internal.migrations.researchWorkspaces.searches, internal.migrations.researchWorkspaces.bookmarks]);

const tableValidator = v.union(v.literal("searches"), v.literal("queryShortcuts"));

/** Searches or bookmarks on one page that have no workspace yet. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 });
    return { missing: page.page.filter((row) => !row.workspaceId || !row.createdBy).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many searches and bookmarks have no workspace; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["searches", "queryShortcuts"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.researchWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
