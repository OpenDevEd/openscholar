import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { assistantMutation, defineUserMutation, reversal, reversedBy, userMutation, type Author } from "../lib/userActions";
import { applyCommand } from "../research/records";
import { undoCommandValidator } from "../../lib/research/records";
import { workUrl } from "../../lib/openalex/work-id";
import { libraryCountRow, resolveLibraryCount } from "./counter";
import { addCollectionMembership, removeCollectionMembership } from "./collectionMembership";
import { followed, inFollowedCollection } from "./followed";

/** What the library keeps about a paper, apart from its rating. */
export const libraryPaper = v.object({
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
const ratingOrNone = v.union(ratingArg, v.null());
/** A paper already in the library, named by its ID alone. `savedAt` says which save it should be: a paper removed and saved afresh has a later one. */
const savedPaper = v.object({ openalexId: v.string(), savedAt: v.optional(v.number()) });
/**
 * A saved paper's rating as a change left it, and which save it's on. An undo is refused once
 * either differs, and still goes through after a later change has itself been undone.
 */
const ratingAsLeft = v.object({ savedAt: v.number(), rating: ratingOrNone });

const REMOVE = "library/mutations:removeFromLibrary" as const;
const RESTORE = "library/mutations:restoreLibraryItem" as const;
const RATE = "library/mutations:setLibraryRating" as const;
const IN_COLLECTION = "library/mutations:setPaperInCollection" as const;
const CHANGE = "research/records:change" as const;

function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

/** A paper's ID as the library keeps it. The assistant gives the bare ID as often as the whole one, and both are the same paper. */
export const canonical = (openalexId: string) => workUrl(openalexId) ?? openalexId;

async function findItem(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, openalexId: string) {
  return await ctx.db
    .query("libraryItems")
    .withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", canonical(openalexId)))
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
 * show, so the page and the assistant leave both the same. Returns the command that
 * puts the research rating back, when it changed. `expect` refuses the change when the
 * research rating isn't that now.
 */
function setResearchRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null, author: Author, expect?: number | null) {
  return applyCommand(ctx, userId, { kind: "rating", paperId: canonical(paperId), rating, ...(expect === undefined ? {} : { expect }) }, author);
}

/** The paper's rating on search cards, or null. */
async function researchRating(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) {
  return (await ctx.db.query("paperRatings").withIndex("by_user_and_paperId", (q) => q.eq("userId", userId).eq("data.paperId", canonical(paperId))).unique())?.data.rating ?? null;
}

async function ownedCollection(ctx: MutationCtx, userId: Id<"users">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "This collection no longer exists.");
  if (collection.userId !== userId) throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

const saveUndo = v.union(reversal(REMOVE, { openalexId: v.string(), expect: ratingAsLeft }), reversal(RATE, { openalexId: v.string(), rating: ratingOrNone, expect: ratingAsLeft }));

/** Whether a save asks the person first: one whose undo would lose the rating the paper has on search cards (see `savePaper`). */
export async function saveAsksFirst(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, openalexId: string, rating: number | undefined) {
  const [item, onCards] = [await findItem(ctx, userId, openalexId), await researchRating(ctx, userId, openalexId)];
  if (!item) return onCards !== null;
  const was = item.rating ?? null;
  return rating !== undefined && rating !== was && onCards !== was;
}

/** Saves a paper, rated when a rating is given, and says what reverses it. */
async function savePaper(ctx: MutationCtx, userId: Id<"users">, given: Infer<typeof libraryPaper>, rating: number | undefined, author: Author): Promise<{ id: Id<"libraryItems">; added: boolean; undo?: Infer<typeof saveUndo> }> {
  if (rating !== undefined) requireRating(rating);
  const paper = { ...given, openalexId: canonical(given.openalexId) };
  const before = await findItem(ctx, userId, paper.openalexId);
  const onCards = await researchRating(ctx, userId, paper.openalexId);
  const id = await upsertLibraryItem(ctx, userId, paper, rating);
  if (rating !== undefined) await setResearchRating(ctx, userId, paper.openalexId, rating, author);
  // What reverses it: a paper it added is removed again, and a rating it changed goes back.
  // A save that changed neither has nothing to undo. Nor has one whose undo would lose the
  // rating the paper had on search cards: removing a paper clears that rating, and a rating
  // put back is put back in both places.
  if (!before) {
    if (onCards !== null) return { id, added: true };
    const saved = (await ctx.db.get("libraryItems", id))!;
    return { id, added: true, undo: { path: REMOVE, args: { openalexId: paper.openalexId, expect: { savedAt: saved.savedAt, rating: rating ?? null } } } };
  }
  const was = before.rating ?? null;
  if (rating === undefined || rating === was || onCards !== was) return { id, added: false };
  return { id, added: false, undo: { path: RATE, args: { openalexId: paper.openalexId, rating: was, expect: { savedAt: before.savedAt, rating } } } };
}

/**
 * Saves a paper whose record an action has just read from OpenAlex (./papers.ts), and puts
 * it in a collection when one is given. One undo for both: a paper this added is removed
 * again, which takes it out of the collection too; one that was already saved goes back to
 * its rating, or leaves the collection.
 */
export const saveReadUndo = v.union(...saveUndo.members, reversal(IN_COLLECTION, { paper: savedPaper, collectionId: v.id("collections"), inCollection: v.boolean(), assignedAt: v.number() }));
export const saveReadValidator = v.object({ id: v.id("libraryItems"), undo: v.optional(saveReadUndo) });
export const saveRead = internalMutation({
  args: { userId: v.id("users"), paper: libraryPaper, rating: v.optional(ratingArg), collectionId: v.optional(v.id("collections")), author: v.union(v.literal("user"), v.literal("assistant")) },
  returns: saveReadValidator,
  handler: async (ctx, { userId, paper, rating, collectionId, author }) => {
    const collection = collectionId ? await ownedCollection(ctx, userId, collectionId) : null;
    const saved = await savePaper(ctx, userId, paper, rating, author);
    if (!collection) return { id: saved.id, ...(saved.undo ? { undo: saved.undo } : {}) };
    const item = (await ctx.db.get("libraryItems", saved.id))!;
    const at = await addCollectionMembership(ctx, { userId, collection, libraryItemId: item._id });
    if (saved.added || at === null) return { id: saved.id, ...(saved.undo ? { undo: saved.undo } : {}) };
    // Already in the library: what this did was put it in the collection, and that's what's taken back. A rating changed with it stays.
    return { id: saved.id, undo: { path: IN_COLLECTION, args: { paper: { openalexId: item.openalexId, savedAt: item.savedAt }, collectionId: collection._id, inCollection: false, assignedAt: at } } };
  },
});

export const saveToLibraryAction = defineUserMutation({
  path: "library/mutations:saveToLibrary",
  description:
    "Saves a paper to the person's library from its whole record, as a results card has it, with or without a rating from 0 to 5. To save a paper by its ID alone, use library/papers:save. Saving a paper that's already there updates its rating when one is given and otherwise keeps it. " +
    "A save that added the paper or changed its rating returns `undo`: the action to run and the arguments to run it with to put things back. It is refused if the paper changed again in between. " +
    "A save has no undo when the paper carried a different rating on search cards, which undoing would lose.",
  args: { ...libraryPaper.fields, rating: v.optional(ratingArg) },
  returns: v.object({ id: v.id("libraryItems"), undo: v.optional(saveUndo) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The saves that return no undo (see `run`): one whose undo would lose the rating the paper has on search cards.
  asksFirst: (ctx, userId, { rating, openalexId }) => saveAsksFirst(ctx, userId, openalexId, rating),
  run: async (ctx, userId, { rating, ...paper }, author) => {
    const { id, undo } = await savePaper(ctx, userId, paper, rating, author);
    return { id, ...(undo ? { undo } : {}) };
  },
});
export const saveToLibrary = userMutation(saveToLibraryAction);
export const saveToLibraryForAssistant = assistantMutation(saveToLibraryAction);

export const setLibraryRatingAction = defineUserMutation({
  path: RATE,
  description:
    "Sets the rating, from 0 to 5, of a paper in the person's library, or removes it (null). The paper stays saved. " +
    "A change returns `undo`: the action to run and the arguments to run it with to put the rating back. It is refused if the rating changed again in between.",
  // `expect` is the rating the paper should have now, and the save it should be on: a change since then refuses this one.
  args: { openalexId: v.string(), rating: ratingOrNone, expect: v.optional(ratingAsLeft) },
  returns: v.object({
    undo: v.optional(v.union(reversal(RATE, { openalexId: v.string(), rating: ratingOrNone, expect: ratingAsLeft }), reversal(CHANGE, { command: undoCommandValidator }))),
  }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The change that returns no undo (see `run`): the library and search cards hold different ratings, and putting one back would lose the other.
  asksFirst: async (ctx, userId, { openalexId, rating }) => {
    const item = await findItem(ctx, userId, openalexId);
    const was = item?.rating ?? null;
    return item !== null && was !== rating && (await researchRating(ctx, userId, openalexId)) !== was;
  },
  run: async (ctx, userId, { openalexId, rating, expect }, author) => {
    if (rating !== null) requireRating(rating);
    const item = await findItem(ctx, userId, openalexId);
    const was = item?.rating ?? null;
    if (expect && (item?.savedAt !== expect.savedAt || was !== expect.rating)) throw createError("CONFLICT", "This rating has changed since then, so it was left as it is.");
    if (!item && rating !== null) throw createError("NOT_FOUND", "This paper isn't in the library, so it has no rating there.");
    const onCards = await researchRating(ctx, userId, openalexId);
    const changed = item !== null && was !== rating;
    if (changed) await ctx.db.patch("libraryItems", item._id, { rating: rating ?? undefined, updatedAt: Date.now() });
    // An undo expects the rating on search cards to be the one it replaces, too.
    const cards = await setResearchRating(ctx, userId, openalexId, rating, author, expect?.rating);
    // A rating goes back in both places at once, so only when both held the same one.
    if (changed) return onCards === was ? { undo: { path: RATE, args: { openalexId, rating: was, expect: { savedAt: item.savedAt, rating } } } } : {};
    // Only the rating on search cards changed, as for a paper that isn't in the library: it goes back there.
    return cards ? { undo: { path: CHANGE, args: { command: cards } } } : {};
  },
});
export const setLibraryRating = userMutation(setLibraryRatingAction);
export const setLibraryRatingForAssistant = assistantMutation(setLibraryRatingAction);

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
  const [collectionIds, assignedAts]: [Id<"collections">[], number[]] = [[], []];
  for (const membership of memberships) {
    if (!membership) continue;
    await removeCollectionMembership(ctx, membership);
    collectionIds.push(membership.collectionId);
    assignedAts.push(membership.assignedAt);
  }
  return { collectionIds, assignedAts };
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
    "Removes a paper from the person's library, with its rating and its place in every collection. " +
    "Returns `undo`: the action to run and the arguments to run it with to put the paper back, within a day.",
  // `expect` is the paper as the save being undone left it: one rated, put in a collection or saved afresh since then stays.
  args: { openalexId: v.string(), expect: v.optional(ratingAsLeft) },
  returns: v.object({ undo: reversedBy(RESTORE, { removalId: v.id("libraryRemovals") }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The paper leaves its collections too, and a library may follow one of them.
  asksFirst: async (ctx, userId, args) => {
    const item = await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", args.openalexId)).unique();
    return item !== null && (await inFollowedCollection(ctx, item._id));
  },
  run: async (ctx, userId, args, author) => {
    const item = await findItem(ctx, userId, args.openalexId);
    if (!item) return {};
    const { collectionIds, assignedAts } = await removeFromCollections(ctx, userId, item._id);
    // Undoing a save leaves a paper that isn't as the save left it: the same save, with that
    // rating in the library and on search cards, in no collection. Refusing here takes back
    // the removals above with the rest of the transaction.
    if (args.expect && (item.savedAt !== args.expect.savedAt || (item.rating ?? null) !== args.expect.rating || (await researchRating(ctx, userId, item.openalexId)) !== args.expect.rating || collectionIds.length > 0)) {
      throw createError("CONFLICT", "This paper has changed since then, so it was left in the library.");
    }
    const more = await removeLeftoverMemberships(ctx, item._id);
    await countedWrite(ctx, userId, -1, () => ctx.db.delete("libraryItems", item._id));
    await setResearchRating(ctx, userId, item.openalexId, null, author);
    const { _id, _creationTime, userId: _owner, ...kept } = item;
    const expiresAt = Date.now() + REMOVAL_KEPT_MS;
    const removalId = await ctx.db.insert("libraryRemovals", { userId, item: kept, collectionIds, assignedAts, expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.library.mutations.forgetRemoval, { removalId });
    if (more) await ctx.scheduler.runAfter(0, internal.library.mutations.removeMemberships, { libraryItemId: item._id });
    return { undo: { path: RESTORE, args: { removalId } } };
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
    "Puts back a paper that removeFromLibrary removed, given that removal's ID, with its rating, its saved date and its place in the collections that still exist. Works once, within a day of the removal. " +
    "It is itself the undo of a removal and returns none: removing the paper again is a new removal, with its own undo.",
  args: { removalId: v.id("libraryRemovals") },
  returns: v.object({ id: v.id("libraryItems") }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The paper goes back into its collections, and a library may follow one of them.
  asksFirst: async (ctx, _userId, { removalId }) => {
    const removal = await ctx.db.get("libraryRemovals", removalId);
    return removal !== null && (await Promise.all(removal.collectionIds.map((collectionId) => followed(ctx, collectionId)))).some(Boolean);
  },
  run: async (ctx, userId, { removalId }, author) => {
    const removal = await ctx.db.get("libraryRemovals", removalId);
    // Its day is over even if the cleanup hasn't reached it yet.
    if (!removal || removal.userId !== userId || removal.expiresAt <= Date.now()) throw createError("NOT_FOUND", "This removal can no longer be undone.");
    const { item, collectionIds, assignedAts } = removal;
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
    for (const [index, collectionId] of collectionIds.entries()) {
      const collection = await ctx.db.get("collections", collectionId);
      // Collections deleted since the removal stay deleted.
      if (collection && collection.userId === userId) {
        await addCollectionMembership(ctx, { userId, collection, libraryItemId, assignedAt: assignedAts?.[index] });
      }
    }
    await ctx.db.delete("libraryRemovals", removalId);
    return { id: libraryItemId };
  },
});
export const restoreLibraryItem = userMutation(restoreLibraryItemAction);
export const restoreLibraryItemForAssistant = assistantMutation(restoreLibraryItemAction);

export const setPaperInCollectionAction = defineUserMutation({
  path: "library/mutations:setPaperInCollection",
  description:
    "Adds a paper to one of the person's collections, saving it to their library first if needed, or takes it out of the collection. Taking it out keeps it in the library. " +
    "The paper is given whole, or by its ID alone when it's already in the library. " +
    "A change returns `undo`: the action to run and the arguments to run it with to put the collection back as it was. Undoing an add leaves the paper in the library.",
  // `assignedAt` is when the paper was put in the collection. Taking it out takes only that
  // place, so one put in again since then stays. Putting it back gives it that place again.
  args: { paper: v.union(libraryPaper, savedPaper), collectionId: v.id("collections"), inCollection: v.boolean(), assignedAt: v.optional(v.number()) },
  returns: v.object({ undo: reversedBy(IN_COLLECTION, { paper: savedPaper, collectionId: v.id("collections"), inCollection: v.boolean(), assignedAt: v.number() }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  asksFirst: (ctx, _userId, { collectionId }) => followed(ctx, collectionId),
  run: async (ctx, userId, { paper, collectionId, inCollection, assignedAt }) => {
    const collection = await ownedCollection(ctx, userId, collectionId);
    const whole = "title" in paper;
    const item = whole && inCollection ? await ctx.db.get("libraryItems", await upsertLibraryItem(ctx, userId, paper)) : await findItem(ctx, userId, paper.openalexId);
    if (!whole && paper.savedAt !== undefined && item && item.savedAt !== paper.savedAt) throw createError("CONFLICT", "This paper was removed and saved again since then, so the collection was left as it is.");
    // Only a change has an undo, so undoing never touches a paper that was already in, or already
    // out. It names the save and the place in the collection it's for.
    const reverse = (at: number) => ({ undo: { path: IN_COLLECTION, args: { paper: { openalexId: paper.openalexId, savedAt: item!.savedAt }, collectionId, inCollection: !inCollection, assignedAt: at } } });
    if (inCollection) {
      if (!item) throw createError("NOT_FOUND", "This paper is no longer in the library.");
      const at = await addCollectionMembership(ctx, { userId, collection, libraryItemId: item._id, assignedAt });
      return at === null ? {} : reverse(at);
    }
    if (!item) return {};
    const membership = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) => q.eq("collectionId", collection._id).eq("libraryItemId", item._id))
      .unique();
    if (!membership) return {};
    if (assignedAt !== undefined && membership.assignedAt !== assignedAt) throw createError("CONFLICT", "This paper was put in the collection again since then, so it was left there.");
    await removeCollectionMembership(ctx, membership);
    return reverse(membership.assignedAt);
  },
});
export const setPaperInCollection = userMutation(setPaperInCollectionAction);
export const setPaperInCollectionForAssistant = assistantMutation(setPaperInCollectionAction);
