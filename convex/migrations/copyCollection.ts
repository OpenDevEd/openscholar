import { v } from "convex/values";
import { internalMutation } from "../lib/functions";

/**
 * Brings a collection a community follows from shared dev to prod (plans/production-launch/copy-collection.py), through
 * the triggers, so a library's and a collection's filter and list counts come out right. Deleted once the communities
 * have moved.
 */
export const collection = internalMutation({
  args: { row: v.any() },
  returns: v.id("collections"),
  handler: async (ctx, { row }) => {
    const id = await ctx.db.insert("collections", row);
    const counted = await ctx.db.query("collectionCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", row.workspaceId)).unique();
    if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: counted.count + 1 });
    else await ctx.db.insert("collectionCounts", { workspaceId: row.workspaceId, count: 1 });
    return id;
  },
});

/** A batch of papers with their places in the collection. A paper the workspace already saved keeps its row. */
export const papers = internalMutation({
  args: { collectionId: v.id("collections"), workspaceId: v.id("workspaces"), rows: v.array(v.object({ item: v.any(), link: v.any() })) },
  returns: v.null(),
  handler: async (ctx, { collectionId, workspaceId, rows }) => {
    let added = 0;
    for (const { item, link } of rows) {
      const held = await ctx.db.query("libraryItems").withIndex("by_workspace_paperKey", (q) => q.eq("workspaceId", workspaceId).eq("paperKey", item.paperKey)).first();
      const libraryItemId = held?._id ?? (await ctx.db.insert("libraryItems", item));
      if (!held) added += 1;
      // A paper prod already holds keeps its own fields: without a saved date, the trigger fills the place from it.
      const place = held ? { assignedAt: link.assignedAt } : link;
      await ctx.db.insert("libraryItemCollections", { ...place, collectionId, libraryItemId });
    }
    const counted = await ctx.db.query("libraryCounts").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).unique();
    if (counted) await ctx.db.patch("libraryCounts", counted._id, { count: counted.count + added });
    else await ctx.db.insert("libraryCounts", { workspaceId, count: added });
    return null;
  },
});
