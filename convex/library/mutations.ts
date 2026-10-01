import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { v, type Infer } from "convex/values";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_LIBRARY_BROWSE } from "../lib/queryBounds";
import { addCollectionMembership, removeCollectionMembership } from "./collectionMembership";

export const backfillLibraryCount = internalMutation({
  args: { userId: v.id("users"), count: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get("users", args.userId);
    if (!user || user.libraryItemCount !== undefined) return;
    await ctx.db.patch("users", args.userId, { libraryItemCount: args.count });
  },
});

export const backfillAllLibraryCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Cardinality: small user base, safe to collect
    const users = await ctx.db.query("users").collect();
    let backfilled = 0;

    for (const user of users) {
      if (user.libraryItemCount !== undefined) continue;

      const items = await ctx.db
        .query("libraryItems")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(MAX_LIBRARY_BROWSE);

      await ctx.db.patch("users", user._id, { libraryItemCount: items.length });
      backfilled++;
    }

    console.log(`Backfilled libraryItemCount for ${backfilled} users`);
  },
});

/** What the library keeps about a paper, apart from its rating. */
const libraryPaper = v.object({
  openalexId: v.string(),
  title: v.string(),
  authors: v.optional(v.string()),
  doi: v.optional(v.string()),
  abstract: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  journal: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),
  paperData: v.optional(v.string()),
});

/** A removed paper as it was, with its collections, so Undo can put it back. */
const removedPaper = schema.tables.libraryItems.validator
  .omit("userId")
  .extend({ collectionIds: v.array(v.id("collections")) });

/** The most collections one paper can be restored into: a user has far fewer. */
const MAX_RESTORED_COLLECTIONS = 500;

function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

async function findItem(ctx: MutationCtx, userId: Id<"users">, openalexId: string) {
  return await ctx.db
    .query("libraryItems")
    .withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", openalexId))
    .unique();
}

async function changeLibraryCount(ctx: MutationCtx, userId: Id<"users">, change: 1 | -1) {
  const user = await ctx.db.get("users", userId);
  if (!user) return;
  await ctx.db.patch("users", userId, { libraryItemCount: Math.max(0, (user.libraryItemCount ?? 0) + change) });
}

/**
 * Saves a paper to the person's library, or updates the copy already there. A rating
 * replaces the saved one; without one, a new paper is saved unrated and a saved paper
 * keeps its rating.
 */
async function upsertLibraryItem(
  ctx: MutationCtx,
  userId: Id<"users">,
  paper: Infer<typeof libraryPaper>,
  rating?: number,
) {
  const searchableText = [paper.title, paper.abstract, paper.authors].filter(Boolean).join(" ");
  const existing = await findItem(ctx, userId, paper.openalexId);
  if (existing) {
    // Keep the metadata and savedAt from the first save.
    await ctx.db.patch("libraryItems", existing._id, {
      ...(rating !== undefined && { rating }),
      ...(paper.paperData !== undefined && { paperData: paper.paperData }),
      searchableText,
      updatedAt: Date.now(),
    });
    return existing._id;
  }
  const now = Date.now();
  const id = await ctx.db.insert("libraryItems", {
    userId,
    ...paper,
    ...(rating !== undefined && { rating }),
    searchableText,
    savedAt: now,
    updatedAt: now,
  });
  await changeLibraryCount(ctx, userId, 1);
  return id;
}

/** Saves a paper, with or without a rating from 0 to 5. */
export const saveToLibrary = mutation({
  args: { ...libraryPaper.fields, rating: v.optional(v.number()) },
  returns: v.id("libraryItems"),
  handler: async (ctx, { rating, ...paper }) => {
    const user = await requireAuth(ctx);
    if (rating !== undefined) requireRating(rating);
    return await upsertLibraryItem(ctx, user._id, paper, rating);
  },
});

/** Removes a paper's rating. The paper stays saved. */
export const clearLibraryRating = mutation({
  args: { openalexId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await findItem(ctx, user._id, args.openalexId);
    if (item && item.rating !== undefined) {
      await ctx.db.patch("libraryItems", item._id, { rating: undefined, updatedAt: Date.now() });
    }
    return null;
  },
});

/** Removes a paper with its rating and collections, and returns it so Undo can put it back. */
export const removeFromLibrary = mutation({
  args: { openalexId: v.string() },
  returns: v.union(removedPaper, v.null()),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await findItem(ctx, user._id, args.openalexId);
    if (!item) return null;
    // Bounded: the collections one saved paper belongs to.
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
      .collect();
    for (const membership of memberships) await removeCollectionMembership(ctx, membership);
    await ctx.db.delete("libraryItems", item._id);
    await changeLibraryCount(ctx, user._id, -1);
    const { _id, _creationTime, userId: _owner, ...kept } = item;
    return { ...kept, collectionIds: memberships.map((membership) => membership.collectionId) };
  },
});

/** Puts back a paper removeFromLibrary removed, with its rating, saved date and surviving collections. */
export const restoreLibraryItem = mutation({
  args: { paper: removedPaper },
  returns: v.id("libraryItems"),
  handler: async (ctx, { paper }) => {
    const user = await requireAuth(ctx);
    const { collectionIds, ...item } = paper;
    if (collectionIds.length > MAX_RESTORED_COLLECTIONS) {
      throw createError("VALIDATION_ERROR", "Too many collections.");
    }
    if (item.rating !== undefined) requireRating(item.rating);
    const existing = await findItem(ctx, user._id, item.openalexId);
    let libraryItemId: Id<"libraryItems">;
    if (existing) {
      // Saved again before Undo: keep that copy and bring back the old rating if it has none.
      libraryItemId = existing._id;
      if (existing.rating === undefined && item.rating !== undefined) {
        await ctx.db.patch("libraryItems", existing._id, { rating: item.rating, updatedAt: Date.now() });
      }
    } else {
      libraryItemId = await ctx.db.insert("libraryItems", { ...item, userId: user._id, updatedAt: Date.now() });
      await changeLibraryCount(ctx, user._id, 1);
    }
    for (const collectionId of collectionIds) {
      const collection = await ctx.db.get("collections", collectionId);
      // Collections deleted since the removal stay deleted.
      if (collection && collection.userId === user._id) {
        await addCollectionMembership(ctx, { userId: user._id, collection, libraryItemId });
      }
    }
    return libraryItemId;
  },
});

/**
 * Adds a paper to one of the person's collections, saving it first if needed, or takes
 * it out of the collection. Taking it out keeps it in the library.
 */
export const setPaperInCollection = mutation({
  args: { paper: libraryPaper, collectionId: v.id("collections"), inCollection: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    if (args.inCollection) {
      const libraryItemId = await upsertLibraryItem(ctx, user._id, args.paper);
      await addCollectionMembership(ctx, { userId: user._id, collection, libraryItemId });
      return null;
    }
    const item = await findItem(ctx, user._id, args.paper.openalexId);
    if (!item) return null;
    const membership = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) => q.eq("collectionId", collection._id).eq("libraryItemId", item._id))
      .unique();
    if (membership) await removeCollectionMembership(ctx, membership);
    return null;
  },
});
