import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { listCounts, workspaceLibrariesOf } from "../lib/listCounts";
import { changeDoiLink, changeGroups, pendingReconciliation } from "../topics/publications";

/**
 * What copying a community's rows to prod doesn't keep up to date, because an import runs no triggers
 * (plans/production-launch/README.md). Safe to run again, and run after each move. Versions are counted by
 * `migrations/pagedLibraryVersions:run` with `{"cursor": null}`. Deleted once the communities have moved.
 *
 *   npx convex run migrations/communityMoveCounts:countLibraries
 *   npx convex run migrations/communityMoveCounts:rebuildTopics
 */
const REBUILD_BATCH = 100;

/** Each community into its workspace's total, which the limit on communities reads. */
export const countLibraries = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("evidenceLibraries").paginate({ cursor: cursor ?? null, numItems: REBUILD_BATCH });
    for (const library of page.page) {
      if (library.workspaceId) await listCounts.insertIfDoesNotExist(ctx, { namespace: workspaceLibrariesOf(library.workspaceId), key: null, id: library._id });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countLibraries, { cursor: page.continueCursor });
    return null;
  },
});

/** Clears what topic pages read and counts it again from every community's locations, a page at a time. */
export const rebuildTopics = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await pendingReconciliation(ctx, 1);
    await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.clearTopicCounts, {});
    return null;
  },
});

export const clearTopicCounts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const groups = await ctx.db.query("topicPublicationGroups").take(REBUILD_BATCH * 5);
    for (const row of groups) await ctx.db.delete("topicPublicationGroups", row._id);
    const links = await ctx.db.query("topicOpenAlexDois").take(REBUILD_BATCH * 5);
    for (const row of links) await ctx.db.delete("topicOpenAlexDois", row._id);
    if (groups.length + links.length > 0) await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.clearTopicCounts, {});
    else await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopics, { cursor: null });
    return null;
  },
});

export const countTopics = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("topicLocations").paginate({ cursor, numItems: REBUILD_BATCH });
    for (const row of page.page) {
      await changeDoiLink(ctx, row, 1);
      await changeGroups(ctx, row, 1);
    }
    if (page.isDone) await pendingReconciliation(ctx, -1);
    else await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopics, { cursor: page.continueCursor });
    return null;
  },
});
