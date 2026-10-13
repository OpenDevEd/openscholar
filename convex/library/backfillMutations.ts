import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { openalexWorkOf, paperKeyOf } from "../../lib/papers/paper-ref";

/**
 * One page of library items, and which of them have no paperData yet and are known to OpenAlex,
 * by their OpenAlex work. The backfill walks every page with the returned cursor, including pages
 * where nothing is missing.
 */
export const getItemsMissingPaperData = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    items: v.array(v.object({ _id: v.id("libraryItems"), work: v.string() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("libraryItems").order("asc").paginate(args.paginationOpts);
    return {
      items: page.page.flatMap((item) => {
        const work = item.paperData ? null : openalexWorkOf(paperKeyOf(item), item.crossRefs);
        return work ? [{ _id: item._id, work }] : [];
      }),
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
    await ctx.db.patch("libraryItems", args.itemId, {
      paperData: args.paperData,
      updatedAt: Date.now(),
    });
  },
});
