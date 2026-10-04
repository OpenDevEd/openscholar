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
import { query, type QueryCtx } from "../../_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { stream } from "convex-helpers/server/stream";
import schema from "../../schema";
import { requireAuth } from "../../lib/auth";
import { requireFeature } from "../../featureFlags/guard";
import { createError } from "../../lib/errors";
import { PAPER_LIMIT } from "@/lib/extraction/limits";
import { paperSelectionValidator } from "../validators";
import type { Doc, Id } from "../../_generated/dataModel";

const collectionIdValidator = v.optional(
  v.union(v.id("collections"), v.literal("unfiled")),
);

function matchesSearch(item: Doc<"libraryItems">, needle: string): boolean {
  return item.searchableText.toLowerCase().includes(needle);
}

const libraryItemValidator = schema.tables.libraryItems.validator.extend({ _id: v.id("libraryItems"), _creationTime: v.number() });

/** Most items one page returns, whatever the caller asks for. */
const PAGE_MAX = 200;
/**
 * Papers an unfiled page reads at most: each is checked for a collection as it's read,
 * so a mostly filed library gets short pages instead of reading every membership (#353).
 */
const UNFILED_PAGE_ROWS = 1_000;
/** Papers "select all unfiled" reads at most. */
const UNFILED_SELECT_ROWS = 4_000;
/** Bytes an unfiled page or "select all" reads at most, whatever its papers' size. */
const UNFILED_BYTES = 8 * 1024 * 1024;

async function isUnfiled(ctx: QueryCtx, item: Doc<"libraryItems">) {
  const membership = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", item._id)).first();
  return membership === null;
}

/** The user's papers not in any collection, newest first. */
function unfiledItems(ctx: QueryCtx, userId: Id<"users">) {
  return stream(ctx.db, schema)
    .query("libraryItems")
    .withIndex("by_user_savedAt", (q) => q.eq("userId", userId))
    .order("desc")
    .filterWith((item) => isUnfiled(ctx, item));
}

async function withoutFiled(ctx: QueryCtx, items: Doc<"libraryItems">[]) {
  const unfiled = await Promise.all(items.map((item) => isUnfiled(ctx, item)));
  return items.filter((_, i) => unfiled[i]);
}

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    query: v.optional(v.string()),
    collectionId: collectionIdValidator,
  },
  returns: paginationResultValidator(libraryItemValidator),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    const user = await requireAuth(ctx);

    const search = args.query?.trim();
    const needle = search?.toLowerCase();
    const paginationOpts = { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, PAGE_MAX) };

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
        .paginate(paginationOpts);
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
      if (!search) {
        return await unfiledItems(ctx, user._id).paginate({ ...paginationOpts, maximumRowsRead: UNFILED_PAGE_ROWS, maximumBytesRead: UNFILED_BYTES });
      }
      const page = await ctx.db
        .query("libraryItems")
        .withSearchIndex("search_library", (q) =>
          q.search("searchableText", search).eq("userId", user._id),
        )
        .paginate(paginationOpts);
      return { ...page, page: await withoutFiled(ctx, page.page) };
    }

    if (search) {
      return await ctx.db
        .query("libraryItems")
        .withSearchIndex("search_library", (q) =>
          q.search("searchableText", search).eq("userId", user._id),
        )
        .paginate(paginationOpts);
    }
    return await ctx.db
      .query("libraryItems")
      .withIndex("by_user_savedAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(paginationOpts);
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
  returns: v.object({ items: paperSelectionValidator(libraryItemValidator), truncated: v.boolean() }),
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
      if (search) {
        const found = await ctx.db
          .query("libraryItems")
          .withSearchIndex("search_library", (q) =>
            q.search("searchableText", search).eq("userId", user._id),
          )
          .take(limit + 1);
        const unfiled = await withoutFiled(ctx, found);
        // More search hits than were read may hold more unfiled papers.
        const truncated = unfiled.length > limit || found.length > limit;
        return { items: unfiled.slice(0, limit), truncated };
      }
      // Stops after UNFILED_SELECT_ROWS papers: when that many are read before the end,
      // there may be more unfiled papers than were selected.
      const page = await unfiledItems(ctx, user._id).paginate({ cursor: null, numItems: limit, maximumRowsRead: UNFILED_SELECT_ROWS, maximumBytesRead: UNFILED_BYTES });
      return { items: page.page, truncated: !page.isDone };
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
