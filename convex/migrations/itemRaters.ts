import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Gives every rated paper in an organization's library who rated it (#801): how many members did
 * and the first of them, beside the average it already keeps. Each paper is re-rated in a
 * transaction of its own, since one reads all its organization's members' ratings.
 *
 *   npx convex run migrations/itemRaters:run
 *   npx convex run migrations/itemRaters:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** Whether a saved paper is an organization's, rated, and still without who rated it. */
async function due(ctx: Pick<QueryCtx, "db">, item: Doc<"libraryItems">) {
  if (item.rating === undefined || item.ratingCount !== undefined) return false;
  return (await ctx.db.get("workspaces", item.workspaceId))?.kind === "organization";
}

export const items = migrations.define({
  table: "libraryItems",
  batchSize: 200,
  migrateOne: async (ctx, item) => {
    if (await due(ctx, item)) await ctx.scheduler.runAfter(0, internal.library.mutations.rerate, { workspaceId: item.workspaceId, paperId: item.openalexId });
  },
});

export const run = migrations.runner(internal.migrations.itemRaters.items);

/** Papers on one page that are still due. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ due: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("libraryItems").paginate({ cursor, numItems: 200 });
    const left = await Promise.all(page.page.map((item) => due(ctx, item)));
    return { due: left.filter(Boolean).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many papers are still due; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let left = 0;
    for (let cursor: string | null = null; ;) {
      const page: { due: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.itemRaters.verifyPage, { cursor });
      left += page.due;
      if (page.isDone) return left;
      cursor = page.continueCursor;
    }
  },
});
