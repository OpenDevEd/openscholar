import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { MAX_COLLECTIONS_PER_USER } from "../lib/queryBounds";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, reversedBy, userMutation, userQuery } from "../lib/userActions";
import { addCollectionMembership, removeCollectionMembership } from "./collectionMembership";
import { followed } from "./followed";
import { collectionSortName } from "./sortName";

/** Most collections one page holds. */
const COLLECTIONS_PAGE_MAX = 50;
/** Convex's full text search takes at most 16 terms. */
const SEARCH_TERMS_MAX = 16;

export function collectionCountRow(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return ctx.db.query("collectionCounts").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
}

export { collectionSortName };

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

const CREATE = "library/collections:createCollection" as const;
const RENAME = "library/collections:renameCollection" as const;
const DELETE = "library/collections:deleteCollection" as const;
const ADD = "library/collections:addToCollection" as const;
const REMOVE = "library/collections:removeFromCollection" as const;
const RETURNS_UNDO = "A change returns `undo`: the action to run and the arguments to run it with to put things back. It is refused if the collection changed again in between.";

/** The person's collection, or the reason it can't be used. */
async function ownCollection(ctx: Pick<MutationCtx, "db">, userId: Id<"users">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "Collection not found");
  if (collection.userId !== userId) throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

/** A collection as its creation left it: its name, with no paper in it. */
const asCreated = v.object({ name: v.string() });

export const createCollectionAction = defineUserMutation({
  path: CREATE,
  description: `Makes a new, empty collection in the person's library, named as given. A person has up to ${MAX_COLLECTIONS_PER_USER}. Returns \`undo\`, which deletes it while it's empty and still has that name.`,
  args: { name: v.string() },
  returns: v.object({ id: v.id("collections"), undo: reversedBy(DELETE, { collectionId: v.id("collections"), expect: asCreated }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, userId, args) => {
    const id = await newCollection(ctx, userId, args.name);
    return { id, undo: { path: DELETE, args: { collectionId: id, expect: { name: args.name.trim() } } } };
  },
});
export const createCollection = userMutation(createCollectionAction);
export const createCollectionForAssistant = assistantMutation(createCollectionAction);

export const renameCollectionAction = defineUserMutation({
  path: RENAME,
  description: `Renames one of the person's collections. ${RETURNS_UNDO}`,
  // `expect` is the name the collection should have now: a rename since then refuses this one.
  args: { collectionId: v.id("collections"), name: v.string(), expect: v.optional(v.string()) },
  returns: v.object({ undo: reversedBy(RENAME, { collectionId: v.id("collections"), name: v.string(), expect: v.string() }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // A library that follows the collection shows its name.
  asksFirst: (ctx, _userId, { collectionId }) => followed(ctx, collectionId),
  run: async (ctx, userId, args) => {
    const collection = await ownCollection(ctx, userId, args.collectionId);
    if (args.expect !== undefined && collection.name !== args.expect) throw createError("CONFLICT", "This collection has been renamed since then, so it was left as it is.");
    const trimmed = args.name.trim();
    if (!trimmed) {
      throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
    }
    if (trimmed === collection.name) return {};
    await ctx.db.patch("collections", args.collectionId, {
      name: trimmed,
      sortName: collectionSortName(trimmed),
      updatedAt: Date.now(),
    });
    return { undo: { path: RENAME, args: { collectionId: args.collectionId, name: collection.name, expect: trimmed } } };
  },
});
export const renameCollection = userMutation(renameCollectionAction);
export const renameCollectionForAssistant = assistantMutation(renameCollectionAction);

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

export const deleteCollectionAction = defineUserMutation({
  path: DELETE,
  description:
    "Deletes one of the person's collections. Its papers stay in the library. This can't be undone. " +
    "`expect` is only for undoing a collection's creation: with it, a collection that was renamed or holds papers since is left as it is. To delete a collection the person asks to delete, leave `expect` out.",
  // `expect` is the collection as the creation being undone left it: one renamed, or with a paper in it, stays.
  args: { collectionId: v.id("collections"), expect: v.optional(asCreated) },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, userId, args) => {
    const collection = await ownCollection(ctx, userId, args.collectionId);
    if (args.expect && (collection.name !== args.expect.name || (collection.itemCount ?? 0) !== 0)) {
      throw createError("CONFLICT", "This collection has been renamed or holds papers now, so it was left as it is.");
    }
    // Its papers' places in it go with it: this batch now, the rest in the batches it schedules.
    if (await deleteMembershipBatch(ctx, args.collectionId)) {
      await ctx.scheduler.runAfter(0, internal.library.collections.deleteMemberships, { collectionId: args.collectionId });
    }
    await ctx.db.delete("collections", args.collectionId);
    const counted = await collectionCountRow(ctx, userId);
    if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: Math.max(0, counted.count - 1) });
    return null;
  },
});
export const deleteCollection = userMutation(deleteCollectionAction);
export const deleteCollectionForAssistant = assistantMutation(deleteCollectionAction);

// ═══════════════════════════════════════════════════════════════
// COLLECTION ASSIGNMENT (Plan 02)
// ═══════════════════════════════════════════════════════════════

// `assignedAt` is when the paper was put in the collection. Taking it out takes only that place,
// so one put in again since then stays. Putting it back gives it that place again.
const membership = { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), assignedAt: v.optional(v.number()) };
const undone = { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), assignedAt: v.number() };

export const addToCollectionAction = defineUserMutation({
  path: ADD,
  description: "Puts a paper that's in the person's library, by its library item ID, into one of their collections. Returns `undo`, which takes it out again, unless it was already there.",
  args: membership,
  returns: v.object({ undo: reversedBy(REMOVE, undone) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  asksFirst: (ctx, _userId, { collectionId }) => followed(ctx, collectionId),
  run: async (ctx, userId, args) => {
    const collection = await ownCollection(ctx, userId, args.collectionId);
    const item = await ctx.db.get("libraryItems", args.libraryItemId);
    if (!item || item.userId !== userId) {
      throw createError("FORBIDDEN", "Not your library item");
    }
    const assignedAt = await addCollectionMembership(ctx, { userId, collection, libraryItemId: args.libraryItemId, assignedAt: args.assignedAt });
    return assignedAt === null ? {} : { undo: { path: REMOVE, args: { collectionId: args.collectionId, libraryItemId: args.libraryItemId, assignedAt } } };
  },
});
export const addToCollection = userMutation(addToCollectionAction);
export const addToCollectionForAssistant = assistantMutation(addToCollectionAction);

export const removeFromCollectionAction = defineUserMutation({
  path: REMOVE,
  description: "Takes a paper, by its library item ID, out of one of the person's collections. It stays in the library. Returns `undo`, which puts it back, unless it wasn't there.",
  args: membership,
  returns: v.object({ undo: reversedBy(ADD, undone) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  asksFirst: (ctx, _userId, { collectionId }) => followed(ctx, collectionId),
  run: async (ctx, userId, args) => {
    await ownCollection(ctx, userId, args.collectionId);
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q
          .eq("collectionId", args.collectionId)
          .eq("libraryItemId", args.libraryItemId)
      )
      .unique();
    if (!existing) {
      // An undo for a paper that has left the library since says so: put back, it's under a new ID.
      if (args.assignedAt !== undefined && !(await ctx.db.get("libraryItems", args.libraryItemId))) throw createError("NOT_FOUND", "This paper has left the library since then.");
      return {};
    }
    if (args.assignedAt !== undefined && existing.assignedAt !== args.assignedAt) throw createError("CONFLICT", "This paper was put in the collection again since then, so it was left there.");
    await removeCollectionMembership(ctx, existing);
    return { undo: { path: ADD, args: { collectionId: args.collectionId, libraryItemId: args.libraryItemId, assignedAt: existing.assignedAt } } };
  },
});
export const removeFromCollection = userMutation(removeFromCollectionAction);
export const removeFromCollectionForAssistant = assistantMutation(removeFromCollectionAction);

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
export const listCollectionsAction = defineUserQuery({
  path: "library/collections:listCollections",
  description:
    `A page of the person's collections by name, each with how many papers it holds, at most ${COLLECTIONS_PAGE_MAX} a page. With \`search\`, those whose name matches, best match first. With a paper's OpenAlex ID, each also says whether that paper is in it.`,
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    openalexId: v.optional(v.string()),
  },
  returns: paginationResultValidator(collectionRow),
  run: async (ctx, userId, args) => {
    const user = { _id: userId };
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
export const listCollections = userQuery(listCollectionsAction);
export const listCollectionsForAssistant = assistantQuery(listCollectionsAction);

export const countCollectionsAction = defineUserQuery({
  path: "library/collections:countCollections",
  description: "How many collections the person has.",
  args: {},
  returns: v.number(),
  // Until migrations/pagedCollections has run everywhere, someone may have no count yet.
  run: async (ctx, userId) => (await collectionCountRow(ctx, userId))?.count ?? 0,
});
export const countCollections = userQuery(countCollectionsAction);
export const countCollectionsForAssistant = assistantQuery(countCollectionsAction);

export const getCollectionAction = defineUserQuery({
  path: "library/collections:getCollection",
  description: "One of the person's collections by its ID: its name and how many papers it holds. Null when it's gone or someone else's.",
  args: { collectionId: v.id("collections") },
  returns: v.union(v.object({ _id: v.id("collections"), name: v.string(), itemCount: v.number() }), v.null()),
  run: async (ctx, userId, args) => {
    const collection = await ctx.db.get("collections", args.collectionId);
    if (!collection || collection.userId !== userId) return null;
    return { _id: collection._id, name: collection.name, itemCount: collection.itemCount ?? 0 };
  },
});
export const getCollection = userQuery(getCollectionAction);
export const getCollectionForAssistant = assistantQuery(getCollectionAction);
