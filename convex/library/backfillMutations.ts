import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * Get a batch of library items that don't have paperData populated.
 */
export const getItemsMissingPaperData = internalMutation({
  args: {
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Query all library items and filter for those missing paperData
    const allItems = await ctx.db
      .query("libraryItems")
      .order("asc")
      .take(args.limit * 10); // Over-fetch to account for items that already have paperData

    const itemsMissing = allItems
      .filter((item) => !item.paperData)
      .slice(0, args.limit);

    const lastItem = itemsMissing[itemsMissing.length - 1];

    return {
      items: itemsMissing.map((item) => ({
        _id: item._id,
        openalexId: item.openalexId,
      })),
      hasMore: allItems.length === args.limit * 10,
      nextCursor: lastItem?._id ?? undefined,
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
    await ctx.db.patch("libraryItems", args.itemId, {
      paperData: args.paperData,
      updatedAt: Date.now(),
    });
  },
});
