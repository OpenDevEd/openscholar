import { v, type Infer } from "convex/values";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { assistantMutation, defineUserMutation, userMutation, type Author } from "../lib/userActions";
import { applyCommand } from "../research/records";
import { resolveLibraryCount } from "./counter";
import { addCollectionMembership, removeCollectionMembership } from "./collectionMembership";

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
  workType: v.optional(v.string()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),
  paperData: v.optional(v.string()),
});

/** A removed paper as it was, with its collections, so Undo can put it back. */
const removedPaper = schema.tables.libraryItems.validator
  .omit("userId")
  .extend({ collectionIds: v.array(v.id("collections")) });

const ratingArg = v.number();

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

/**
 * Runs a write that adds or removes one paper and keeps the person's library count.
 * The count is read before the write, because a missing one is repaired by counting papers.
 */
async function countedWrite<T>(ctx: MutationCtx, userId: Id<"users">, change: 1 | -1, write: () => Promise<T>) {
  const user = await ctx.db.get("users", userId);
  const current = user ? await resolveLibraryCount(ctx, userId, user.libraryItemCount) : null;
  const result = await write();
  if (current !== null) {
    await ctx.db.patch("users", userId, { libraryItemCount: Math.max(0, current + change) });
  }
  return result;
}

/**
 * Saves a paper to the person's library, or updates the copy already there. A rating
 * replaces the saved one; without one, a new paper is saved unrated and a saved
 * paper keeps its rating. Screening saves qualified papers through here too.
 */
export async function upsertLibraryItem(
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
  return await countedWrite(ctx, userId, 1, () =>
    ctx.db.insert("libraryItems", {
      userId,
      ...paper,
      ...(rating !== undefined && { rating }),
      searchableText,
      savedAt: now,
      updatedAt: now,
    }),
  );
}

/**
 * Mirrors a library rating into the person's research ratings, which search cards
 * show, so the page and the assistant leave both the same.
 */
async function setResearchRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null, author: Author) {
  await applyCommand(ctx, userId, { kind: "rating", paperId, rating }, author);
}

async function ownedCollection(ctx: MutationCtx, userId: Id<"users">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection || collection.userId !== userId) {
    throw createError("FORBIDDEN", "Not your collection");
  }
  return collection;
}

export const saveToLibraryAction = defineUserMutation({
  path: "library/mutations:saveToLibrary",
  description:
    "Saves a paper to the person's library, with or without a rating from 0 to 5. Saving a paper that's already there updates its rating when one is given and otherwise keeps it.",
  args: { ...libraryPaper.fields, rating: v.optional(ratingArg) },
  returns: v.id("libraryItems"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { rating, ...paper }, author) => {
    if (rating !== undefined) requireRating(rating);
    const id = await upsertLibraryItem(ctx, userId, paper, rating);
    if (rating !== undefined) await setResearchRating(ctx, userId, paper.openalexId, rating, author);
    return id;
  },
});
export const saveToLibrary = userMutation(saveToLibraryAction);
export const saveToLibraryForAssistant = assistantMutation(saveToLibraryAction);

export const clearLibraryRatingAction = defineUserMutation({
  path: "library/mutations:clearLibraryRating",
  description: "Removes the rating from a paper in the person's library. The paper stays saved.",
  args: { openalexId: v.string() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, args, author) => {
    const item = await findItem(ctx, userId, args.openalexId);
    if (item && item.rating !== undefined) {
      await ctx.db.patch("libraryItems", item._id, { rating: undefined, updatedAt: Date.now() });
    }
    await setResearchRating(ctx, userId, args.openalexId, null, author);
    return null;
  },
});
export const clearLibraryRating = userMutation(clearLibraryRatingAction);
export const clearLibraryRatingForAssistant = assistantMutation(clearLibraryRatingAction);

export const removeFromLibraryAction = defineUserMutation({
  path: "library/mutations:removeFromLibrary",
  description:
    "Removes a paper from the person's library, with its rating and its place in every collection. Returns the removed paper so restoreLibraryItem can put it back.",
  args: { openalexId: v.string() },
  returns: v.union(removedPaper, v.null()),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, args, author) => {
    const item = await findItem(ctx, userId, args.openalexId);
    if (!item) return null;
    // Bounded: one saved paper belongs to at most MAX_COLLECTIONS_PER_USER collections.
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", item._id))
      .collect();
    for (const membership of memberships) await removeCollectionMembership(ctx, membership);
    await countedWrite(ctx, userId, -1, () => ctx.db.delete("libraryItems", item._id));
    await setResearchRating(ctx, userId, item.openalexId, null, author);
    const { _id, _creationTime, userId: _owner, ...kept } = item;
    return { ...kept, collectionIds: memberships.map((membership) => membership.collectionId) };
  },
});
export const removeFromLibrary = userMutation(removeFromLibraryAction);
export const removeFromLibraryForAssistant = assistantMutation(removeFromLibraryAction);

export const restoreLibraryItemAction = defineUserMutation({
  path: "library/mutations:restoreLibraryItem",
  description:
    "Puts back a paper that removeFromLibrary removed, with its rating, its saved date and the collections that still exist.",
  args: { paper: removedPaper },
  returns: v.id("libraryItems"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { paper }, author) => {
    const { collectionIds, ...item } = paper;
    if (collectionIds.length > MAX_COLLECTIONS_PER_USER) {
      throw createError("VALIDATION_ERROR", "Too many collections.");
    }
    if (item.rating !== undefined) requireRating(item.rating);
    const existing = await findItem(ctx, userId, item.openalexId);
    let libraryItemId: Id<"libraryItems">;
    if (existing) {
      // Saved again before Undo: keep that copy and bring back the old rating if it has none.
      libraryItemId = existing._id;
      if (existing.rating === undefined && item.rating !== undefined) {
        await ctx.db.patch("libraryItems", existing._id, { rating: item.rating, updatedAt: Date.now() });
        await setResearchRating(ctx, userId, item.openalexId, item.rating, author);
      }
    } else {
      libraryItemId = await countedWrite(ctx, userId, 1, () =>
        ctx.db.insert("libraryItems", { ...item, userId, updatedAt: Date.now() }),
      );
      if (item.rating !== undefined) await setResearchRating(ctx, userId, item.openalexId, item.rating, author);
    }
    for (const collectionId of collectionIds) {
      const collection = await ctx.db.get("collections", collectionId);
      // Collections deleted since the removal stay deleted.
      if (collection && collection.userId === userId) {
        await addCollectionMembership(ctx, { userId, collection, libraryItemId });
      }
    }
    return libraryItemId;
  },
});
export const restoreLibraryItem = userMutation(restoreLibraryItemAction);
export const restoreLibraryItemForAssistant = assistantMutation(restoreLibraryItemAction);

export const setPaperInCollectionAction = defineUserMutation({
  path: "library/mutations:setPaperInCollection",
  description:
    "Adds a paper to one of the person's collections, saving it to their library first if needed, or takes it out of the collection. Taking it out keeps it in the library.",
  args: { paper: libraryPaper, collectionId: v.id("collections"), inCollection: v.boolean() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, args) => {
    const collection = await ownedCollection(ctx, userId, args.collectionId);
    if (args.inCollection) {
      const libraryItemId = await upsertLibraryItem(ctx, userId, args.paper);
      await addCollectionMembership(ctx, { userId, collection, libraryItemId });
      return null;
    }
    const item = await findItem(ctx, userId, args.paper.openalexId);
    if (!item) return null;
    const membership = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) => q.eq("collectionId", collection._id).eq("libraryItemId", item._id))
      .unique();
    if (membership) await removeCollectionMembership(ctx, membership);
    return null;
  },
});
export const setPaperInCollection = userMutation(setPaperInCollectionAction);
export const setPaperInCollectionForAssistant = assistantMutation(setPaperInCollectionAction);
