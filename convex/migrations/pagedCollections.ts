import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { collectionCountRow, collectionSortName } from "../library/collections";

/**
 * Readies collections to list a page at a time (#420): each gets the `sortName` the list
 * orders by, and each person who has any gets the count row the pages total from.
 * Collections made or renamed since already have both. Safe to run again.
 *
 *   npx convex run migrations/pagedCollections:run '{"dryRun": true}'
 *   npx convex run migrations/pagedCollections:run
 *   npx convex run migrations/pagedCollections:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** A person's collections, counted: at most MAX_COLLECTIONS_PER_USER, which createCollection enforces. */
async function countOf(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return (await ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", userId)).take(MAX_COLLECTIONS_PER_USER)).length;
}

export const prepare = migrations.define({
  table: "collections",
  batchSize: 50,
  migrateOne: async (ctx, collection) => {
    // Counted in the same transaction as the write, so a collection made meanwhile can't be missed.
    if (!(await collectionCountRow(ctx, collection.userId))) {
      await ctx.db.insert("collectionCounts", { userId: collection.userId, count: await countOf(ctx, collection.userId) });
    }
    const sortName = collectionSortName(collection.name);
    if (collection.sortName !== sortName) return { sortName };
  },
});

export const run = migrations.runner(internal.migrations.pagedCollections.prepare);

/** Problems on one page of collections: a wrong sort name, or an owner whose count is missing or wrong. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("collections").paginate({ cursor, numItems: 20 });
    let wrong = page.page.filter((collection) => collection.sortName !== collectionSortName(collection.name)).length;
    for (const userId of new Set(page.page.map((collection) => collection.userId))) {
      if ((await collectionCountRow(ctx, userId))?.count !== (await countOf(ctx, userId))) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many problems `verifyPage` finds across every collection; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedCollections.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) return wrong;
      cursor = page.continueCursor;
    }
  },
});
