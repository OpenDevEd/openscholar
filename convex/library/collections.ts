import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "../lib/functions";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { addCollectionMembership, removeCollectionMembership } from "./collectionMembership";

/** Most collections one page holds. */
const COLLECTIONS_PAGE_MAX = 50;
/** Convex's full text search takes at most 16 terms. */
const SEARCH_TERMS_MAX = 16;

export function collectionCountRow(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("collectionCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

/** How collections sort: by name, ignoring case and accents. */
export function collectionSortName(name: string) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
// COLLECTION CRUD (Plan 01 prerequisites)
// ═══════════════════════════════════════════════════════════════

/** Makes an empty collection of `userId`'s named `name`, and counts it. */
export async function newCollection(ctx: MutationCtx, userId: Id<"users">, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
  }
  const existing = await ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", userId)).take(MAX_COLLECTIONS_PER_USER);
  if (existing.length >= MAX_COLLECTIONS_PER_USER) {
    throw createError("VALIDATION_ERROR", `You can have up to ${MAX_COLLECTIONS_PER_USER} collections. Delete one to make another.`);
  }
  // Every collection was just read for the cap, so a missing count starts exact.
  const counted = await collectionCountRow(ctx, userId);
  if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: counted.count + 1 });
  else await ctx.db.insert("collectionCounts", { userId, count: existing.length + 1 });
  return await ctx.db.insert("collections", {
    userId,
    name: trimmed,
    sortName: collectionSortName(trimmed),
    itemCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

export const createCollection = mutation({
  args: { name: v.string() },
  returns: v.id("collections"),
  handler: async (ctx, args) => newCollection(ctx, (await requireAuth(ctx))._id, args.name),
});

export const renameCollection = mutation({
  args: { collectionId: v.id("collections"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection) {
      throw createError("NOT_FOUND", "Collection not found");
    }
    if (collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    const trimmed = args.name.trim();
    if (!trimmed) {
      throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    }
    await ctx.db.patch("collections", args.collectionId, {
      name: trimmed,
      sortName: collectionSortName(trimmed),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Memberships one transaction deletes of a collection being deleted. */
const MEMBERSHIP_DELETE_BATCH = 2_000;

/** Deletes a batch of a deleted collection's memberships; says whether more are left. */
async function deleteMembershipBatch(ctx: MutationCtx, collectionId: Id<"collections">) {
  const memberships = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
    .take(MEMBERSHIP_DELETE_BATCH);
  for (const membership of memberships) await ctx.db.delete("libraryItemCollections", membership._id);
  return memberships.length === MEMBERSHIP_DELETE_BATCH;
}

/** Deletes the next batch of a deleted collection's memberships, until none are left. */
export const deleteMemberships = internalMutation({
  args: { collectionId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, { collectionId }) => {
    if (await deleteMembershipBatch(ctx, collectionId)) {
      await ctx.scheduler.runAfter(0, internal.library.collections.deleteMemberships, { collectionId });
    }
    return null;
  },
});

export const deleteCollection = mutation({
  args: { collectionId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection) {
      throw createError("NOT_FOUND", "Collection not found");
    }
    if (collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    // Its papers' places in it go with it: this batch now, the rest in the batches it schedules.
    if (await deleteMembershipBatch(ctx, args.collectionId)) {
      await ctx.scheduler.runAfter(0, internal.library.collections.deleteMemberships, { collectionId: args.collectionId });
    }
    await ctx.db.delete("collections", args.collectionId);
    const counted = await collectionCountRow(ctx, user._id);
    if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: Math.max(0, counted.count - 1) });
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// COLLECTION ASSIGNMENT (Plan 02)
// ═══════════════════════════════════════════════════════════════

export const addToCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify collection ownership
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }

    // Verify library item ownership
    const item = await ctx.db.get("libraryItems", args.libraryItemId);
    if (!item || item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    await addCollectionMembership(ctx, {
      userId: user._id,
      collection,
      libraryItemId: args.libraryItemId,
    });
    return null;
  },
});

export const removeFromCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify collection ownership
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }

    // Find and delete junction row if it exists
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q
          .eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) await removeCollectionMembership(ctx, existing);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// COLLECTION QUERIES (Plan 02)
// ═══════════════════════════════════════════════════════════════

const collectionRow = v.object({
  _id: v.id("collections"),
  name: v.string(),
  itemCount: v.number(),
  /** Whether the paper asked about is in it; false when none was asked about. */
  containsItem: v.boolean(),
});

/**
 * A page of the person's collections by name, or those whose name matches `search`, best
 * match first. Given a paper by its OpenAlex ID, each says whether the paper is in it; the
 * ID stays the same when the paper is first saved, so the list keeps its place.
 */
export const listCollections = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    openalexId: v.optional(v.string()),
  },
  returns: paginationResultValidator(collectionRow),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const paginationOpts = { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, COLLECTIONS_PAGE_MAX) };
    const search = args.search?.trim().split(/\s+/).slice(0, SEARCH_TERMS_MAX).join(" ");
    const page = await (search
      ? ctx.db.query("collections").withSearchIndex("search_name", (q) => q.search("name", search).eq("userId", user._id))
      : ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", user._id))
    ).paginate(paginationOpts);
    const { openalexId } = args;
    const item = openalexId
      ? await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", user._id).eq("openalexId", openalexId)).unique()
      : null;
    const libraryItemId = item?._id;
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (collection) => ({
          _id: collection._id,
          name: collection.name,
          // Until migrations/backfillLibraryCounters has run everywhere, a collection may have no count yet.
          itemCount: collection.itemCount ?? 0,
          containsItem:
            libraryItemId !== undefined &&
            (await ctx.db
              .query("libraryItemCollections")
              .withIndex("by_collection_item", (q) => q.eq("collectionId", collection._id).eq("libraryItemId", libraryItemId))
              .unique()) !== null,
        })),
      ),
    };
  },
});

/** How many collections the person has, for page totals. */
export const countCollections = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    // Until migrations/pagedCollections has run everywhere, someone may have no count yet.
    return (await collectionCountRow(ctx, user._id))?.count ?? 0;
  },
});

/** One of the person's collections, or null when it's gone or someone else's. */
export const getCollection = query({
  args: { collectionId: v.id("collections") },
  returns: v.union(v.object({ _id: v.id("collections"), name: v.string(), itemCount: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) return null;
    return { _id: collection._id, name: collection.name, itemCount: collection.itemCount ?? 0 };
  },
});
