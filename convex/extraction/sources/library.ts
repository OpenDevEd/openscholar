/**
 * Paginated library-item reader scoped to the bucket UX. Unified
 * reader for the merged Library tab: supports an optional
 * `collectionId` filter that selects one of three scopes:
 *   - absent      → every libraryItem the user has saved
 *   - an Id       → items in that collection (junction join)
 *   - "unfiled"   → items not in any collection
 * Optional `query` runs the `search_library` fulltext index in the
 * no-collection branch, and a case-insensitive `searchableText`
 * match in the collection-scoped branches (the search index is
 * keyed on libraryItems directly and can't be composed with the
 * junction join).
 */
import { query } from "../../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import type { Doc, Id } from "../../_generated/dataModel";

const collectionIdValidator = v.optional(
  v.union(v.id("collections"), v.literal("unfiled")),
);

function matchesSearch(item: Doc<"libraryItems">, needle: string): boolean {
  return item.searchableText.toLowerCase().includes(needle);
}

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    query: v.optional(v.string()),
    collectionId: collectionIdValidator,
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const search = args.query?.trim();
    const needle = search?.toLowerCase();

    if (args.collectionId && args.collectionId !== "unfiled") {
      const collectionId = args.collectionId;
      const collection = await ctx.db.get(collectionId);
      if (!collection || collection.userId !== user._id) {
        throw createError("NOT_FOUND", "Collection not found");
      }
      const page = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
        .order("desc")
        .paginate(args.paginationOpts);
      const joined = await Promise.all(
        page.page.map((row) =>
          ctx.db.get(row.libraryItemId as Id<"libraryItems">),
        ),
      );
      let items = joined.filter(
        (item): item is Doc<"libraryItems"> => item !== null,
      );
      if (needle) items = items.filter((item) => matchesSearch(item, needle));
      return { ...page, page: items };
    }

    if (args.collectionId === "unfiled") {
      const junctions = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const filedSet = new Set(junctions.map((j) => j.libraryItemId));
      const page = search
        ? await ctx.db
            .query("libraryItems")
            .withSearchIndex("search_library", (q) =>
              q.search("searchableText", search).eq("userId", user._id),
            )
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("libraryItems")
            .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
            .order("desc")
            .paginate(args.paginationOpts);
      return {
        ...page,
        page: page.page.filter((item) => !filedSet.has(item._id)),
      };
    }

    if (search) {
      return await ctx.db
        .query("libraryItems")
        .withSearchIndex("search_library", (q) =>
          q.search("searchableText", search).eq("userId", user._id),
        )
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("libraryItems")
      .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * Server-side "select everything that matches" reader for the bucket's
 * mass-select affordance. Reads up to (paperLimit + 1) rows — the extra
 * row signals truncation without another query — then slices down to
 * the cap. Mirrors the three-way branch on `collectionId` used by `list`.
 */
export const listAllIds = query({
  args: {
    query: v.optional(v.string()),
    collectionId: collectionIdValidator,
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);
    const limit = PAPER_LIMIT;

    const search = args.query?.trim();
    const needle = search?.toLowerCase();

    if (args.collectionId && args.collectionId !== "unfiled") {
      const collectionId = args.collectionId;
      const collection = await ctx.db.get(collectionId);
      if (!collection || collection.userId !== user._id) {
        throw createError("NOT_FOUND", "Collection not found");
      }
      const rows = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
        .order("desc")
        .take(limit + 1);
      const joined = await Promise.all(
        rows.map((row) => ctx.db.get(row.libraryItemId as Id<"libraryItems">)),
      );
      let items = joined.filter(
        (item): item is Doc<"libraryItems"> => item !== null,
      );
      if (needle) items = items.filter((item) => matchesSearch(item, needle));
      const truncated = items.length > limit;
      return {
        items: truncated ? items.slice(0, limit) : items,
        truncated,
      };
    }

    if (args.collectionId === "unfiled") {
      const junctions = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const filedSet = new Set(junctions.map((j) => j.libraryItemId));
      // Oversample by filedSet.size so we can still find `limit` unfiled
      // items when most of the library is filed. Bounded above by
      // Convex's 8192-row take() limit.
      const scanSize = Math.min(8192, limit + filedSet.size + 1);
      const rows = search
        ? await ctx.db
            .query("libraryItems")
            .withSearchIndex("search_library", (q) =>
              q.search("searchableText", search).eq("userId", user._id),
            )
            .take(scanSize)
        : await ctx.db
            .query("libraryItems")
            .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(scanSize);
      const unfiled = rows.filter((item) => !filedSet.has(item._id));
      const truncated = unfiled.length > limit;
      return {
        items: truncated ? unfiled.slice(0, limit) : unfiled,
        truncated,
      };
    }

    const rows = search
      ? await ctx.db
          .query("libraryItems")
          .withSearchIndex("search_library", (q) =>
            q.search("searchableText", search).eq("userId", user._id),
          )
          .take(limit + 1)
      : await ctx.db
          .query("libraryItems")
          .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
          .order("desc")
          .take(limit + 1);

    const truncated = rows.length > limit;
    return {
      items: truncated ? rows.slice(0, limit) : rows,
      truncated,
    };
  },
});
