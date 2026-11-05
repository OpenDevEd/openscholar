import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { internalMutation } from "../lib/functions";
import { listCounts, workspaceLibrariesOf } from "../lib/listCounts";
import { publicationGroupKey } from "../../lib/topics/identity";
import { changeDoiLink, changeGroups, linkedDois, pendingReconciliation } from "../topics/publications";

/**
 * What copying a community's rows to prod doesn't keep up to date, because an import runs no triggers
 * (plans/production-launch/README.md). Safe to run again, and run after each move. Versions are counted by
 * `migrations/pagedLibraryVersions:run` with `{"reset": true}`. Deleted once the communities have moved.
 *
 *   npx convex run migrations/communityMoveCounts:countLibraries
 *   npx convex run migrations/communityMoveCounts:rebuildTopics
 *
 * Deliveries are refused during a topic rebuild and the communities retry them. If a rebuild's chain dies, its flag
 * stays set: start again from `clearTopicCounts`.
 */
const REBUILD_BATCH = 100;
// A location holds up to 100 topics, and each costs a lookup and a patch's two reads; one step may make 4,096.
const GROUP_BATCH = 10;

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

const projectionState = (ctx: MutationCtx) => ctx.db.query("topicProjectionState").withIndex("by_key", (q) => q.eq("key", "publications")).unique();

/** Clears what topic pages read and counts it again from every community's locations, a page at a time. */
export const rebuildTopics = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const before = await projectionState(ctx);
    if (before?.rebuilding || (before?.pending ?? 0) > 0) throw createError("CONFLICT", "A rebuild or reconciliation is still running");
    await pendingReconciliation(ctx, 1);
    const state = await projectionState(ctx);
    await ctx.db.patch("topicProjectionState", state!._id, { rebuilding: true });
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
    else await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopicLinks, { cursor: null });
    return null;
  },
});

/** DOI links come first: a location's group key depends on them, and a key can name a community still on dev. */
export const countTopicLinks = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("topicLocations").paginate({ cursor, numItems: REBUILD_BATCH });
    for (const row of page.page) await changeDoiLink(ctx, row, 1);
    if (page.isDone) await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopicGroups, { cursor: null });
    else await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopicLinks, { cursor: page.continueCursor });
    return null;
  },
});

export const countTopicGroups = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("topicLocations").paginate({ cursor, numItems: GROUP_BATCH });
    for (const row of page.page) {
      const groupKey = publicationGroupKey(row.libraryId, row.itemKey, row.doi, row.openalexId, await linkedDois(ctx, row.openalexId));
      if (groupKey !== row.groupKey) await ctx.db.patch("topicLocations", row._id, { groupKey });
      await changeGroups(ctx, { ...row, groupKey }, 1);
    }
    if (page.isDone) {
      await pendingReconciliation(ctx, -1);
      const state = await projectionState(ctx);
      await ctx.db.patch("topicProjectionState", state!._id, { rebuilding: undefined });
    } else await ctx.scheduler.runAfter(0, internal.migrations.communityMoveCounts.countTopicGroups, { cursor: page.continueCursor });
    return null;
  },
});
