import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { collectionCountRow } from "./counter";
import { requireMakerOrAdmin, type Actor, type InWorkspace } from "../workspaces/actor";
import { COLLECTION_UNDO_MS } from "../../lib/library/limits";
import { makersIn, makerValidator } from "../workspaces/makers";
import { searchTerms } from "../lib/searchText";
import type { QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../lib/functions";
import { v } from "convex/values";
import { createError } from "../lib/errors";
import { planLimit } from "../billing/accounts";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, reversedBy, userMutation, userQuery, workspaceMutation } from "../lib/userActions";
import { addCollectionMembership, editableCollection, removeCollectionMembership } from "./collectionMembership";
import { findItem } from "./find";
import { asRaters, collectionRatingRow, collectionRatingsOf, everyRater, organizationOfCollection, placeOf, purgeCollectionRatings, raterValidator, ratingOrNone, requireRating, setCollectionRating as setRating, shownRater } from "../ratings";
import { collectionHome, followed, shownOutside } from "./followed";
import { copyFacetBatch } from "./facets";
import { collectionSortName } from "./sortName";
import { countOf } from "../lib/listCounts";
import { guestRole, itemGuestsOf } from "../sharing/items";
import { guestRoleValidator, sharedFromValidator } from "../sharing/validators";
import { workspaceFrom } from "../workspaces/personal";
import { paperKeyOf } from "../../lib/papers/paper-ref";

/** Most collections one page holds. */
const COLLECTIONS_PAGE_MAX = 50;

export { collectionSortName };

// ═══════════════════════════════════════════════════════════════
// COLLECTION CRUD (Plan 01 prerequisites)
// ═══════════════════════════════════════════════════════════════

/** Whether `userId` can make a collection named `name` in `workspaceId`: its name trimmed, and the workspace's count row, read for the cap. */
export async function collectionAllowed(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw createError("VALIDATION_ERROR", "Collection name cannot be empty");
  }
  // A workspace with no count row has never had a collection.
  const counted = await collectionCountRow(ctx, workspaceId);
  const most = await planLimit(ctx, workspaceId, "collections");
  if (most !== undefined && (counted?.count ?? 0) >= most) {
    throw createError("VALIDATION_ERROR", `Your plan allows ${most.toLocaleString("en")} collections. Delete one to make another, or change plan for more.`);
  }
  return { trimmed, counted };
}

/** Makes an empty collection named `name` in the writer's workspace, and counts it. */
export async function newCollection(ctx: MutationCtx, { userId, workspaceId }: InWorkspace, name: string) {
  const { trimmed, counted } = await collectionAllowed(ctx, { userId, workspaceId }, name);
  if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: counted.count + 1 });
  else await ctx.db.insert("collectionCounts", { workspaceId, count: 1 });
  return await ctx.db.insert("collections", {
    workspaceId,
    createdBy: userId,
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
const RATE = "library/collections:setCollectionRating" as const;
const RETURNS_UNDO = "A change returns `undo`: the action to run and the arguments to run it with to put things back. It is refused if the collection changed again in between.";

/** The workspace's collection, or the reason it can't be used. */
async function ownCollection(ctx: Pick<MutationCtx, "db">, workspaceId: Id<"workspaces">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "Collection not found");
  if (collection.workspaceId !== workspaceId) throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

/** A collection as its creation left it: its name, with no paper in it. */
const asCreated = v.object({ name: v.string() });

export const createCollectionAction = defineUserMutation({
  path: CREATE,
  activity: (args, { id }) => ({ kind: "collection", id, happened: "created", detail: args.name.trim() }),
  description: `Makes a new, empty collection in the person's library, named as given, as many as their plan allows. Returns \`undo\`, which deletes it while it's empty and still has that name.`,
  args: { name: v.string() },
  returns: v.object({ id: v.id("collections"), undo: reversedBy(DELETE, { collectionId: v.id("collections"), expect: asCreated }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, { userId, workspaceId }, args) => {
    const id = await newCollection(ctx, { userId, workspaceId }, args.name);
    return { id, undo: { path: DELETE, args: { collectionId: id, expect: { name: args.name.trim() } } } };
  },
});
export const createCollection = userMutation(createCollectionAction);
export const createCollectionForAssistant = assistantMutation(createCollectionAction);

export const renameCollectionAction = defineUserMutation({
  path: RENAME,
  // Renamed from the name its undo puts back; a rename to the same name changed nothing.
  activity: (args, { undo }) => (undo ? { kind: "collection", id: args.collectionId, happened: "renamed", detail: undo.args.name } : null),
  description: `Renames one of the person's collections. ${RETURNS_UNDO}`,
  // `expect` is the name the collection should have now: a rename since then refuses this one.
  args: { collectionId: v.id("collections"), name: v.string(), expect: v.optional(v.string()) },
  returns: v.object({ undo: reversedBy(RENAME, { collectionId: v.id("collections"), name: v.string(), expect: v.string() }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // A library that follows the collection shows its name.
  asksFirst: (ctx, _actor, { collectionId }) => followed(ctx, collectionId),
  seenOutside: true,
  run: async (ctx, { workspaceId }, args) => {
    const collection = await ownCollection(ctx, workspaceId, args.collectionId);
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

/** Deletes a batch of a deleted collection's memberships, then of its ratings; says whether more are left. */
async function deleteMembershipBatch(ctx: MutationCtx, collectionId: Id<"collections">) {
  const memberships = await ctx.db
    .query("libraryItemCollections")
    .withIndex("by_collection", (q) => q.eq("collectionId", collectionId))
    .take(MEMBERSHIP_DELETE_BATCH);
  for (const membership of memberships) await ctx.db.delete("libraryItemCollections", membership._id);
  if (memberships.length === MEMBERSHIP_DELETE_BATCH) return true;
  return !(await purgeCollectionRatings(ctx, collectionId, MEMBERSHIP_DELETE_BATCH));
}

/** Gives the next batch of a paper's memberships its changed fields (convex/library/facets.ts). */
export const copyFacets = internalMutation({
  args: { libraryItemId: v.id("libraryItems"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { libraryItemId, cursor }) => {
    await copyFacetBatch(ctx, libraryItemId, cursor);
    return null;
  },
});

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

export const setCollectionRatingAction = defineUserMutation({
  path: RATE,
  activity: (args, { undo }) => (undo ? { kind: "collection", id: args.collectionId, happened: "rated", count: 1 } : null),
  description:
    "Sets the person's rating, from 0 to 5, of a paper within one of the organization's collections, by its library item ID, or removes it (null). " +
    "The organization's members see each other's ratings there, and the collection sorts and filters by their average. The person's own rating of the paper, the same everywhere, stays as it is. " +
    "A collection in the person's own workspace has no ratings of its own: library/mutations:setLibraryRating rates the paper there. " +
    "A change returns `undo`, which puts the rating back. It is refused if the rating changed again in between.",
  // `expect` is the person's rating there as it should be now: a change since then refuses this one.
  args: { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), rating: ratingOrNone, expect: v.optional(ratingOrNone) },
  returns: v.object({ undo: reversedBy(RATE, { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), rating: ratingOrNone, expect: ratingOrNone }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, { userId, workspaceId }, { collectionId, libraryItemId, rating, expect }) => {
    if (rating !== null) requireRating(rating);
    await ownCollection(ctx, workspaceId, collectionId);
    if ((await ctx.db.get("workspaces", workspaceId))?.kind !== "organization") {
      throw createError("VALIDATION_ERROR", "A collection in the person's own workspace has no ratings of its own: rate the paper with library/mutations:setLibraryRating.");
    }
    const item = await ctx.db.get("libraryItems", libraryItemId);
    const place = item && (await placeOf(ctx, collectionId, libraryItemId));
    if (!item || !place) throw createError("NOT_FOUND", "This paper isn't in the collection.");
    const was = (await collectionRatingRow(ctx, userId, collectionId, paperKeyOf(item)))?.rating ?? null;
    if (expect !== undefined && was !== expect) throw createError("CONFLICT", "This rating has changed since then, so it was left as it is.");
    if (was === rating) return {};
    await setRating(ctx, userId, place, item, rating);
    return { undo: { path: RATE, args: { collectionId, libraryItemId, rating: was, expect: rating } } };
  },
});
export const setCollectionRating = userMutation(setCollectionRatingAction);
export const setCollectionRatingForAssistant = assistantMutation(setCollectionRatingAction);

export const ratersAction = defineUserQuery({
  path: "library/collections:raters",
  description:
    "Lists how the members of the organization the person is in rated a paper, by its library item ID: each rating from 0 to 5 with who gave it. " +
    "With a collection of the organization's, their ratings of it there, which a guest of the collection reads too. With none, their own ratings of it, which its library's average is made of and only its members read, all in one page. " +
    "A collection in the person's own workspace has no ratings of its own.",
  args: { collectionId: v.optional(v.id("collections")), libraryItemId: v.id("libraryItems"), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(raterValidator),
  run: async (ctx, actor, { collectionId, libraryItemId, paginationOpts }) => {
    const { userId, workspaceId } = actor;
    if (!collectionId) {
      // The members' own ratings of a paper in the organization's library (#801), for its members alone.
      const item = await ctx.db.get("libraryItems", libraryItemId);
      if (!item || item.workspaceId !== workspaceId) throw createError("NOT_FOUND", "This paper isn't in the library.");
      const workspace = await ctx.db.get("workspaces", workspaceId);
      // Every member's rating comes in the first page, read from the members and not from everyone who rated the paper: asked for past it, there is no more.
      if (workspace?.kind !== "organization" || paginationOpts.cursor !== null) return { page: [], isDone: true, continueCursor: "" };
      return { page: (await everyRater(ctx, workspace.organizationId, paperKeyOf(item), userId)).map(shownRater), isDone: true, continueCursor: "" };
    }
    const collection = await ctx.db.get("collections", collectionId);
    // Its workspace's members read them, and so does a guest of it, from their own workspace.
    if (!collection || (collection.workspaceId !== workspaceId && !(await guestRole(ctx, actor, collection)))) throw createError("NOT_FOUND", "Collection not found.");
    const item = await ctx.db.get("libraryItems", libraryItemId);
    // A paper taken out of the collection keeps its ratings there for a return, and they're no longer the collection's to show.
    if (!item || item.workspaceId !== collection.workspaceId || !(await placeOf(ctx, collectionId, libraryItemId))) throw createError("NOT_FOUND", "This paper isn't in the collection.");
    const organizationId = await organizationOfCollection(ctx, collectionId);
    if (!organizationId) return { page: [], isDone: true, continueCursor: "" };
    const read = await collectionRatingsOf(ctx, collectionId, paperKeyOf(item)).paginate(paginationOpts);
    return { ...read, page: (await asRaters(ctx, organizationId, read.page, userId)).map(shownRater) };
  },
});
export const raters = userQuery(ratersAction);
export const ratersForAssistant = assistantQuery(ratersAction);

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
  run: async (ctx, actor, args) => {
    const collection = await ownCollection(ctx, actor.workspaceId, args.collectionId);
    requireMakerOrAdmin(actor, collection.createdBy);
    if (args.expect && (collection.name !== args.expect.name || collection.itemCount !== 0)) {
      throw createError("CONFLICT", "This collection has been renamed or holds papers now, so it was left as it is.");
    }
    await removeCollection(ctx, actor.workspaceId, args.collectionId);
    return null;
  },
});
export const deleteCollection = userMutation(deleteCollectionAction);
export const deleteCollectionForAssistant = assistantMutation(deleteCollectionAction);

/** Deletes a collection: its papers' places in it go with it, this batch now and the rest in the batches it schedules. */
async function removeCollection(ctx: MutationCtx, workspaceId: Id<"workspaces">, collectionId: Id<"collections">) {
  if (await deleteMembershipBatch(ctx, collectionId)) {
    await ctx.scheduler.runAfter(0, internal.library.collections.deleteMemberships, { collectionId });
  }
  await ctx.db.delete("collections", collectionId);
  const counted = await collectionCountRow(ctx, workspaceId);
  if (counted) await ctx.db.patch("collectionCounts", counted._id, { count: Math.max(0, counted.count - 1) });
}

const heldArgs = { collectionId: v.id("collections") };

/** One of the workspace's collections that the person may delete: its maker, or an admin. */
async function deletableBy(ctx: MutationCtx, actor: Actor, collectionId: Id<"collections">) {
  const collection = await ownCollection(ctx, actor.workspaceId, collectionId);
  requireMakerOrAdmin(actor, collection.createdBy);
  return collection;
}

/**
 * The Library page's delete, which its Undo takes back with `keepCollection`: the collection is
 * deleted once the Undo has had its time, and a moment more for a click at its end to arrive. The
 * wait is held here and not in the page, so leaving or reloading the page doesn't cancel the deletion.
 * Returns the deletion's mark, which its Undo gives back.
 */
export const deleteSoon = workspaceMutation({
  args: heldArgs,
  returns: v.number(),
  handler: async (ctx, actor, { collectionId }) => {
    await deletableBy(ctx, actor, collectionId);
    const deletingAt = Date.now();
    await ctx.db.patch("collections", collectionId, { deletingAt });
    await ctx.scheduler.runAfter(COLLECTION_UNDO_MS + 1_000, internal.library.collections.deleteDue, { collectionId, deletingAt });
    return deletingAt;
  },
});

/** Undo of the `deleteSoon` that made `deletingAt`: the collection stays, unless someone deleted it again since, and then theirs stands. */
export const keepCollection = workspaceMutation({
  args: { ...heldArgs, deletingAt: v.number() },
  returns: v.null(),
  handler: async (ctx, actor, { collectionId, deletingAt }) => {
    const collection = await deletableBy(ctx, actor, collectionId);
    if (collection.deletingAt === deletingAt) await ctx.db.patch("collections", collectionId, { deletingAt: undefined });
    return null;
  },
});

/** Deletes a collection whose Undo ran out, unless it was kept, or deleted again since: then that deletion's own time says. */
export const deleteDue = internalMutation({
  args: { collectionId: v.id("collections"), deletingAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { collectionId, deletingAt }) => {
    const collection = await ctx.db.get("collections", collectionId);
    if (collection?.deletingAt === deletingAt) await removeCollection(ctx, collection.workspaceId, collectionId);
    return null;
  },
});

// ═══════════════════════════════════════════════════════════════
// COLLECTION ASSIGNMENT (Plan 02)
// ═══════════════════════════════════════════════════════════════

// `assignedAt` is when the paper was put in the collection. Taking it out takes only that place,
// so one put in again since then stays. Putting it back gives it that place again.
const membership = { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), assignedAt: v.optional(v.number()) };
const undone = { collectionId: v.id("collections"), libraryItemId: v.id("libraryItems"), assignedAt: v.number() };

export const addToCollectionAction = defineUserMutation({
  path: ADD,
  activity: (args, { undo }) => (undo ? { kind: "collection", id: args.collectionId, happened: "added", count: 1 } : null),
  activityIn: collectionHome,
  description:
    "Puts a paper that's in the person's library, by its library item ID, into one of their collections. Returns `undo`, which takes it out again, unless it was already there. " +
    "A collection shared with the person to edit takes a paper of its own library the same way.",
  args: membership,
  returns: v.object({ undo: reversedBy(REMOVE, undone) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  asksFirst: shownOutside,
  seenOutside: true,
  run: async (ctx, actor, args) => {
    const collection = await editableCollection(ctx, actor, args.collectionId);
    const item = await ctx.db.get("libraryItems", args.libraryItemId);
    // A collection holds papers of its own workspace's library.
    if (!item || item.workspaceId !== collection.workspaceId) {
      throw createError("FORBIDDEN", "Not your library item");
    }
    const assignedAt = await addCollectionMembership(ctx, { collection, item, assignedAt: args.assignedAt });
    return assignedAt === null ? {} : { undo: { path: REMOVE, args: { collectionId: args.collectionId, libraryItemId: args.libraryItemId, assignedAt } } };
  },
});
export const addToCollection = userMutation(addToCollectionAction);
export const addToCollectionForAssistant = assistantMutation(addToCollectionAction);

export const removeFromCollectionAction = defineUserMutation({
  path: REMOVE,
  // Only a paper that was in it is taken out; its undo says so.
  activity: (args, { undo }) => (undo ? { kind: "collection", id: args.collectionId, happened: "removed", count: 1 } : null),
  activityIn: collectionHome,
  description:
    "Takes a paper, by its library item ID, out of one of the person's collections, or one shared with them to edit. It stays in the library. Returns `undo`, which puts it back, unless it wasn't there.",
  args: membership,
  returns: v.object({ undo: reversedBy(ADD, undone) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  asksFirst: shownOutside,
  seenOutside: true,
  run: async (ctx, actor, args) => {
    await editableCollection(ctx, actor, args.collectionId);
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
  /** Who made it, in an organization (#656). */
  by: v.optional(makerValidator),
});

/**
 * A page of the person's collections by name, or those whose name matches `search`, best
 * match first. Given a paper by its key, each says whether the paper is in it; the key stays
 * the same when the paper is first saved, so the list keeps its place.
 */
export const listCollectionsAction = defineUserQuery({
  path: "library/collections:listCollections",
  description:
    `A page of the person's collections by name, each with how many papers it holds, at most ${COLLECTIONS_PAGE_MAX} a page. With \`search\`, those whose name matches, best match first. With \`paper\`, a paper's key or OpenAlex ID, each also says whether that paper is in it. In an organization each names who made it, and \`by\` keeps only that member's (their \`userId\` from workspaces/makers:counts).`,
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    paper: v.optional(v.string()),
    by: v.optional(v.id("users")),
  },
  returns: paginationResultValidator(collectionRow),
  run: async (ctx, { userId, workspaceId }, args) => {
    const paginationOpts = { ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, COLLECTIONS_PAGE_MAX) };
    const search = searchTerms(args.search);
    const { by } = args;
    const page = await (search
      ? ctx.db.query("collections").withSearchIndex("search_name", (q) => (by ? q.search("name", search).eq("workspaceId", workspaceId).eq("createdBy", by) : q.search("name", search).eq("workspaceId", workspaceId)))
      : by
        ? ctx.db.query("collections").withIndex("by_workspace_and_createdBy_and_sortName", (q) => q.eq("workspaceId", workspaceId).eq("createdBy", by))
        : ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspaceId))
    ).paginate(paginationOpts);
    const makerOf = await makersIn(ctx, workspaceId, userId);
    const item = args.paper ? await findItem(ctx, workspaceId, args.paper) : null;
    const libraryItemId = item?._id;
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (collection) => ({
          _id: collection._id,
          name: collection.name,
          itemCount: collection.itemCount,
          ...(await makerOf(collection.createdBy).then((maker) => (maker ? { by: maker } : {}))),
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
  // A workspace with no count row has never had a collection.
  run: async (ctx, { workspaceId }) => (await collectionCountRow(ctx, workspaceId))?.count ?? 0,
});
export const countCollections = userQuery(countCollectionsAction);
export const countCollectionsForAssistant = assistantQuery(countCollectionsAction);

export const getCollectionAction = defineUserQuery({
  path: "library/collections:getCollection",
  description:
    "One of the workspace's collections by its ID, or one shared with the person from another workspace: its name and how many papers it holds. " +
    "One of the workspace's comes with `guests`: how many people outside the workspace it's shared with, invitations still waiting included. " +
    "A shared one comes with `guest`: what they may do with it (`viewer` or `editor`) and whose it is. Null when it's gone or isn't theirs to open.",
  // The Library reads the ID from its address: text that is no collection's ID answers null, as a collection that is gone does (#826).
  args: { collectionId: v.string() },
  returns: v.union(
    v.object({ _id: v.id("collections"), name: v.string(), itemCount: v.number(), guests: v.optional(v.number()), guest: v.optional(v.object({ role: guestRoleValidator, from: sharedFromValidator })) }),
    v.null(),
  ),
  run: async (ctx, actor, args) => {
    const id = ctx.db.normalizeId("collections", args.collectionId);
    const collection = id ? await ctx.db.get("collections", id) : null;
    if (!collection) return null;
    const own = { _id: collection._id, name: collection.name, itemCount: collection.itemCount };
    if (collection.workspaceId === actor.workspaceId) return { ...own, guests: await countOf(ctx, itemGuestsOf(collection._id)) };
    const role = await guestRole(ctx, actor, collection);
    return role ? { ...own, guest: { role, from: await workspaceFrom(ctx, collection.workspaceId) } } : null;
  },
});
export const getCollection = userQuery(getCollectionAction);
export const getCollectionForAssistant = assistantQuery(getCollectionAction);
