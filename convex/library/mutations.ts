import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { assistantMutation, defineUserMutation, userMutation, type Author } from "../lib/userActions";
import { applyCommand } from "../research/records";
import { libraryCountRow, resolveLibraryCount } from "./counter";
import { addCollectionMembership, removeCollectionMembership, touchCollectionsIfLookupChanged } from "./collectionMembership";

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
 * Runs a write that adds or removes one paper and keeps the person's library count, in its
 * own row so the user row stays unwritten (#383). The count is read before the write,
 * because a missing one is repaired by counting papers; only a person without a count row
 * yet has their user row read, to start it.
 */
async function countedWrite<T>(ctx: MutationCtx, userId: Id<"users">, change: 1 | -1, write: () => Promise<T>) {
  const row = await libraryCountRow(ctx, userId);
  let current = row?.count ?? null;
  if (!row) {
    const user = await ctx.db.get("users", userId);
    current = user ? await resolveLibraryCount(ctx, userId, user.libraryItemCount) : null;
  }
  const result = await write();
  if (current !== null) {
    const count = Math.max(0, current + change);
    if (row) await ctx.db.patch("libraryCounts", row._id, { count });
    else await ctx.db.insert("libraryCounts", { userId, count });
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
    if (paper.paperData !== undefined) await touchCollectionsIfLookupChanged(ctx, existing, paper.paperData);
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

/** How long a removed paper is kept for Undo. */
const REMOVAL_KEPT_MS = 24 * 60 * 60_000;

/**
 * Takes a paper out of every collection it's in, looked up collection by collection (the
 * person has at most MAX_COLLECTIONS_PER_USER), and says which those were. Undo needs all
 * of them, so they're found here, in the removal's own transaction.
 */
async function removeFromCollections(ctx: MutationCtx, userId: Id<"users">, libraryItemId: Id<"libraryItems">) {
  const collections = await ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", userId)).take(MAX_COLLECTIONS_PER_USER);
  const memberships = await Promise.all(
    collections.map((collection) =>
      ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collection._id).eq("libraryItemId", libraryItemId)).first(),
    ),
  );
  const collectionIds: Id<"collections">[] = [];
  for (const membership of memberships) {
    if (!membership) continue;
    await removeCollectionMembership(ctx, membership);
    collectionIds.push(membership.collectionId);
  }
  return collectionIds;
}

/**
 * Deletes a batch of the membership rows a removed paper still has: rows a deleted
 * collection left behind, since its live ones are gone. Says whether more are left.
 */
async function removeLeftoverMemberships(ctx: MutationCtx, libraryItemId: Id<"libraryItems">) {
  const leftover = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_item", (q) => q.eq("libraryItemId", libraryItemId))
    .take(MAX_COLLECTIONS_PER_USER);
  for (const membership of leftover) await ctx.db.delete("libraryItemCollections", membership._id);
  return leftover.length === MAX_COLLECTIONS_PER_USER;
}

export const removeFromLibraryAction = defineUserMutation({
  path: "library/mutations:removeFromLibrary",
  description:
    "Removes a paper from the person's library, with its rating and its place in every collection. Returns the ID of the removal, which restoreLibraryItem takes to put the paper back within a day.",
  args: { openalexId: v.string() },
  returns: v.union(v.id("libraryRemovals"), v.null()),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, args, author) => {
    const item = await findItem(ctx, userId, args.openalexId);
    if (!item) return null;
    const collectionIds = await removeFromCollections(ctx, userId, item._id);
    const more = await removeLeftoverMemberships(ctx, item._id);
    await countedWrite(ctx, userId, -1, () => ctx.db.delete("libraryItems", item._id));
    await setResearchRating(ctx, userId, item.openalexId, null, author);
    const { _id, _creationTime, userId: _owner, ...kept } = item;
    const expiresAt = Date.now() + REMOVAL_KEPT_MS;
    const removalId = await ctx.db.insert("libraryRemovals", { userId, item: kept, collectionIds, expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.library.mutations.forgetRemoval, { removalId });
    if (more) await ctx.scheduler.runAfter(0, internal.library.mutations.removeMemberships, { libraryItemId: item._id });
    return removalId;
  },
});
export const removeFromLibrary = userMutation(removeFromLibraryAction);
export const removeFromLibraryForAssistant = assistantMutation(removeFromLibraryAction);

/** Deletes the next batch of the membership rows a removed paper left, until none are left. */
export const removeMemberships = internalMutation({
  args: { libraryItemId: v.id("libraryItems") },
  returns: v.null(),
  handler: async (ctx, { libraryItemId }) => {
    if (await removeLeftoverMemberships(ctx, libraryItemId)) {
      await ctx.scheduler.runAfter(0, internal.library.mutations.removeMemberships, { libraryItemId });
    }
    return null;
  },
});

/** Deletes a removal once its day for Undo is over. */
export const forgetRemoval = internalMutation({
  args: { removalId: v.id("libraryRemovals") },
  returns: v.null(),
  handler: async (ctx, { removalId }) => {
    if (await ctx.db.get("libraryRemovals", removalId)) await ctx.db.delete("libraryRemovals", removalId);
    return null;
  },
});

export const restoreLibraryItemAction = defineUserMutation({
  path: "library/mutations:restoreLibraryItem",
  description:
    "Puts back a paper that removeFromLibrary removed, given that removal's ID, with its rating, its saved date and the collections that still exist. Works once, within a day of the removal.",
  args: { removalId: v.id("libraryRemovals") },
  returns: v.id("libraryItems"),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, { removalId }, author) => {
    const removal = await ctx.db.get("libraryRemovals", removalId);
    // Its day is over even if the cleanup hasn't reached it yet.
    if (!removal || removal.userId !== userId || removal.expiresAt <= Date.now()) throw createError("NOT_FOUND", "This removal can no longer be undone.");
    const { item, collectionIds } = removal;
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
    await ctx.db.delete("libraryRemovals", removalId);
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
