import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { MAX_COLLECTION_MEMBERS } from "../lib/queryBounds";

/**
 * Gives every user a `libraryItemCount` and every collection an exact `itemCount`, so a
 * later change can make both required and drop the recount fallbacks (#353). Widen,
 * migrate, then narrow (docs/agents/project.md): run on each deployment, check `verify`
 * comes back empty, and only then narrow the schema.
 *
 *   npx convex run migrations/backfillLibraryCounters:run '{"dryRun": true}'
 *   npx convex run migrations/backfillLibraryCounters:run
 *   npx convex run migrations/backfillLibraryCounters:backfillUsers '{"dryRun": true}'
 *   npx convex run migrations/backfillLibraryCounters:backfillUsers
 *   npx convex run migrations/backfillLibraryCounters:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** One collection's papers, counted from its memberships: at most MAX_COLLECTION_MEMBERS small rows. */
async function countMembers(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">) {
  const memberships = await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId)).take(MAX_COLLECTION_MEMBERS + 1);
  if (memberships.length > MAX_COLLECTION_MEMBERS) throw new Error(`Collection ${collectionId} has more than ${MAX_COLLECTION_MEMBERS} papers`);
  return memberships.length;
}

/**
 * Sets every collection's count from its memberships, not only missing ones: a collection
 * without a count that gained or lost a paper since was counted from 0. One collection
 * per transaction, so its memberships and the write are read and made together.
 */
export const recountCollections = migrations.define({
  table: "collections",
  batchSize: 1,
  migrateOne: async (ctx, collection) => {
    const itemCount = await countMembers(ctx, collection._id);
    if (collection.itemCount !== itemCount) return { itemCount };
  },
});

export const run = migrations.runner(internal.migrations.backfillLibraryCounters.recountCollections);

/** Users without a library count, a page of users at a time. */
export const usersWithoutCount = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ userIds: v.array(v.id("users")), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("users").paginate({ cursor, numItems: 200 });
    return { userIds: page.page.filter((user) => user.libraryItemCount === undefined).map((user) => user._id), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** One page of a user's saved papers, counted. */
export const countLibraryPage = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ count: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db.query("libraryItems").withIndex("by_user", (q) => q.eq("userId", userId)).paginate({ cursor, numItems: 1_000 });
    return { count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Sets a user's count only while it's still missing. A save or removal meanwhile either
 * set it first, from its own recount, and this leaves it, or comes after and counts on
 * from this one.
 */
export const setLibraryCountIfMissing = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { userId, count }) => {
    const user = await ctx.db.get("users", userId);
    if (!user || user.libraryItemCount !== undefined) return false;
    await ctx.db.patch("users", userId, { libraryItemCount: count });
    return true;
  },
});

/** Counts each user's library a page at a time, so a library of any size fits. */
export const backfillUsers = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({ missing: v.number(), set: v.number() }),
  handler: async (ctx, { dryRun = false }): Promise<{ missing: number; set: number }> => {
    let missing = 0;
    let set = 0;
    for (let cursor: string | null = null; ;) {
      const page: { userIds: Id<"users">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.backfillLibraryCounters.usersWithoutCount, { cursor });
      for (const userId of page.userIds) {
        missing++;
        let count = 0;
        for (let items: string | null = null; ;) {
          const counted: { count: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.backfillLibraryCounters.countLibraryPage, { userId, cursor: items });
          count += counted.count;
          if (counted.isDone) break;
          items = counted.continueCursor;
        }
        if (!dryRun && (await ctx.runMutation(internal.migrations.backfillLibraryCounters.setLibraryCountIfMissing, { userId, count }))) set++;
      }
      if (page.isDone) return { missing, set };
      cursor = page.continueCursor;
    }
  },
});

/** One collection whose count isn't its memberships', for `verify`. */
export const wrongCollectionPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("collections").paginate({ cursor, numItems: 1 });
    const wrong: string[] = [];
    for (const collection of page.page) {
      const count = await countMembers(ctx, collection._id);
      if (collection.itemCount !== count) wrong.push(`${collection._id}: counted ${collection.itemCount ?? "nothing"}, has ${count}`);
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Users still without a count and collections whose count is wrong; both empty when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ usersWithoutCount: v.number(), wrongCollections: v.array(v.string()) }),
  handler: async (ctx): Promise<{ usersWithoutCount: number; wrongCollections: string[] }> => {
    let usersWithoutCount = 0;
    for (let cursor: string | null = null; ;) {
      const page: { userIds: Id<"users">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.backfillLibraryCounters.usersWithoutCount, { cursor });
      usersWithoutCount += page.userIds.length;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    const wrongCollections: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { wrong: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.backfillLibraryCounters.wrongCollectionPage, { cursor });
      wrongCollections.push(...page.wrong);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { usersWithoutCount, wrongCollections };
  },
});
