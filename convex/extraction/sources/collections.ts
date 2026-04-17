/**
 * Collection-scoped library reader for the bucket UX. Joins
 * libraryItemCollections → libraryItems ordered by assignment time.
 * Uses the existing listCollections query (convex/library/collections.ts)
 * for the collection picker itself.
 */
import { query } from "../../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { getPaperLimit } from "../bucket/limits";
import type { Doc, Id } from "../../_generated/dataModel";

export const listItems = query({
  args: {
    collectionId: v.id("collections"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("NOT_FOUND", "Collection not found");
    }

    const page = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    const items = await Promise.all(
      page.page.map(async (row): Promise<Doc<"libraryItems"> | null> => {
        return await ctx.db.get(
          row.libraryItemId as Id<"libraryItems">,
        );
      }),
    );

    return {
      ...page,
      page: items.filter((item): item is Doc<"libraryItems"> => item !== null),
    };
  },
});

/**
 * Server-side "select everything in this collection" reader. Mirrors
 * library.listAllIds but joins libraryItemCollections → libraryItems
 * in assignment-time order. Capped at the per-user paper limit with a
 * truncated flag so the client can surface accurate feedback.
 */
export const listAllItems = query({
  args: {
    collectionId: v.id("collections"),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("NOT_FOUND", "Collection not found");
    }

    const limit = await getPaperLimit(ctx, user._id);
    const rows = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .order("desc")
      .take(limit + 1);

    const joined = await Promise.all(
      rows.map(async (row): Promise<Doc<"libraryItems"> | null> =>
        ctx.db.get(row.libraryItemId as Id<"libraryItems">),
      ),
    );
    const items = joined.filter(
      (item): item is Doc<"libraryItems"> => item !== null,
    );
    const truncated = items.length > limit;
    return {
      items: truncated ? items.slice(0, limit) : items,
      truncated,
    };
  },
});
