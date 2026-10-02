import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { touchCollectionsIfLookupChanged } from "./collectionMembership";

/**
 * One page of library items, and which of them have no paperData yet. The backfill walks
 * every page with the returned cursor, including pages where nothing is missing.
 */
export const getItemsMissingPaperData = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    items: v.array(v.object({ _id: v.id("libraryItems"), openalexId: v.string() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("libraryItems").order("asc").paginate(args.paginationOpts);
    return {
      items: page.page.filter((item) => !item.paperData).map((item) => ({ _id: item._id, openalexId: item.openalexId })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Patch a single library item with paperData.
 */
export const patchPaperData = internalMutation({
  args: {
    itemId: v.id("libraryItems"),
    paperData: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get("libraryItems", args.itemId);
    await ctx.db.patch("libraryItems", args.itemId, {
      paperData: args.paperData,
      updatedAt: Date.now(),
    });
    if (item) await touchCollectionsIfLookupChanged(ctx, item, args.paperData);
  },
});
