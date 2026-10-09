import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { internalMutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { ASKS_FIRST, actingAs, assistantMutation, defineUserMutation, reversal, reversedBy, userMutation, type Acting, type Author } from "../lib/userActions";
import { requireMakerOrAdmin, type InWorkspace } from "../workspaces/actor";
import { endStep } from "../assistant/steps";
import { noteActivity } from "../activity/notes";
import { undoCommandValidator } from "../../lib/research/records";
import { canonical, findItem } from "./find";
import { libraryCountRow } from "./counter";
import { addCollectionMembership, livePlaces, removeCollectionMembership } from "./collectionMembership";
import { followed, inFollowedCollection } from "./followed";
import { authorDisplay, mergePaperMetadata } from "../../lib/library/paper-metadata";
import { MAX_AUTHORS } from "../lib/listCaps";
import { personalRatingRow, rateItem, ratingOrNone, requireRating, rerate as rerateCopy, rerateMemberStep, setPersonalRating } from "../ratings";

/** What the library keeps about a paper, apart from its rating. */
export const libraryPaper = v.object({
  openalexId: v.string(),
  title: v.string(),
  authors: v.optional(v.array(v.string())),
  authorsUnparsed: v.optional(v.string()),
  doi: v.optional(v.string()),
  abstract: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  journal: v.optional(v.string()),
  citedByCount: v.optional(v.number()),
  workType: v.optional(v.string()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),
  oaUrl: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
  paperData: v.optional(v.string()),
});

const ratingArg = v.number();
/** A paper already in the library, named by its ID alone. `savedAt` says which save it should be: a paper removed and saved afresh has a later one. */
const savedPaper = v.object({ openalexId: v.string(), savedAt: v.optional(v.number()) });
/**
 * A saved paper's rating as a change left it, and which save it's on. An undo is refused once
 * either differs, and still goes through after a later change has itself been undone.
 */
const ratingAsLeft = v.object({
  savedAt: v.number(),
  rating: ratingOrNone,
  /** On the undo of a save that put the paper in a collection: that place, the one the paper may still have, by its collection and when it was given. */
  collectionId: v.optional(v.id("collections")),
  assignedAt: v.optional(v.number()),
});

const REMOVE = "library/mutations:removeFromLibrary" as const;
const RESTORE = "library/mutations:restoreLibraryItem" as const;
const RATE = "library/mutations:setLibraryRating" as const;
const IN_COLLECTION = "library/mutations:setPaperInCollection" as const;
const CHANGE = "research/records:change" as const;

/**
 * Runs a write that adds or removes one paper and keeps the person's library count, in its
 * own row so the user row stays unwritten (#383).
 */
async function countedWrite<T>(ctx: MutationCtx, { workspaceId }: InWorkspace, change: 1 | -1, write: () => Promise<T>) {
  const row = await libraryCountRow(ctx, workspaceId);
  const result = await write();
  const count = Math.max(0, (row?.count ?? 0) + change);
  if (row) await ctx.db.patch("libraryCounts", row._id, { count });
  else await ctx.db.insert("libraryCounts", { workspaceId, count });
  return result;
}

/**
 * Saves a paper to the workspace's library, or updates the copy already there. A rating sets the
 * writer's own (`preserveRating` keeps one they have already); the paper's rating is its people's
 * average of theirs (../ratings.ts). Screening saves qualified papers through here too.
 */
export async function upsertLibraryItem(
  ctx: MutationCtx,
  writer: InWorkspace,
  paper: Infer<typeof libraryPaper>,
  rating?: number,
  options: { preserveRating?: boolean } = {},
) {
  const { userId, workspaceId } = writer;
  const existing = await findItem(ctx, workspaceId, paper.openalexId);
  // Project only metadata: system fields, ownership, dates and ratings never enter this merge.
  const before = existing ? Object.fromEntries(Object.keys(libraryPaper.fields).map((key) => [key, existing[key as keyof typeof existing]])) as Infer<typeof libraryPaper> : { title: "" };
  const merged = mergePaperMetadata(before, paper);
  if (merged.authors && merged.authors.length > MAX_AUTHORS) {
    merged.authorsUnparsed = merged.authors.join(", ");
    merged.authors = undefined;
  }
  const searchableText = [merged.title, merged.abstract, authorDisplay(merged)].filter(Boolean).join(" ");
  const rate = async () => {
    if (rating !== undefined && !(options.preserveRating && (await ownRating(ctx, userId, paper.openalexId)) !== null)) await setPersonalRating(ctx, userId, paper.openalexId, rating);
  };
  if (existing) {
    await ctx.db.patch("libraryItems", existing._id, { ...merged, searchableText, updatedAt: Date.now() });
    await rate();
    return existing._id;
  }
  const now = Date.now();
  const id = await countedWrite(ctx, writer, 1, () =>
    ctx.db.insert("libraryItems", {
      workspaceId,
      createdBy: userId,
      ...paper,
      ...merged,
      metadataVersion: 2,
      // Every writer saves through here, so a paper has one row whatever form its ID came in.
      openalexId: canonical(paper.openalexId),
      searchableText,
      savedAt: now,
      updatedAt: now,
    }),
  );
  await rate();
  // Its people may have rated it before it was saved here.
  await rateItem(ctx, (await ctx.db.get("libraryItems", id))!);
  return id;
}

/** The person's own rating of a paper, the same everywhere (#655), or null. */
async function ownRating(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) {
  return (await personalRatingRow(ctx, userId, paperId))?.rating ?? null;
}

async function ownedCollection(ctx: MutationCtx, workspaceId: Id<"workspaces">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "This collection no longer exists.");
  if (collection.workspaceId !== workspaceId) throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

/** What takes a paper out of a collection again, or puts it back: the undo of a change to its place there. */
const placeUndo = reversal(IN_COLLECTION, { paper: savedPaper, collectionId: v.id("collections"), inCollection: v.boolean(), assignedAt: v.number() });
const removeUndo = reversal(REMOVE, { openalexId: v.string(), expect: ratingAsLeft, rating: v.optional(ratingOrNone) });
const saveUndo = v.union(removeUndo, reversal(RATE, { openalexId: v.string(), rating: ratingOrNone, expect: ratingAsLeft }), placeUndo);

/**
 * What a save of a paper by its ID refuses before it reads anything from outside, and the
 * paper as the library has it already: a rating out of range, a collection that isn't the
 * person's, and a saved paper given a collection and a rating that changes anything, in the
 * library or on search cards, which would be two changes with one undo between them.
 */
export async function checkSave(ctx: QueryCtx, { userId, workspaceId }: InWorkspace, { openalexId, rating, collectionId }: { openalexId: string; rating?: number; collectionId?: Id<"collections"> }) {
  if (rating !== undefined) requireRating(rating);
  if (collectionId !== undefined) {
    const collection = await ctx.db.get("collections", collectionId);
    if (!collection) throw createError("NOT_FOUND", "Collection not found");
    if (collection.workspaceId !== workspaceId) throw createError("FORBIDDEN", "Not your collection");
  }
  const before = await findItem(ctx, workspaceId, openalexId);
  if (before && collectionId !== undefined && rating !== undefined && rating !== (await ownRating(ctx, userId, openalexId))) {
    throw createError("VALIDATION_ERROR", "This paper is already saved. Rate it with library/mutations:setLibraryRating and put it in the collection with library/papers:collect, one change at a time, so each can be undone.");
  }
  return before;
}

async function savePaper(ctx: MutationCtx, writer: InWorkspace, given: Infer<typeof libraryPaper>, rating: number | undefined, author: Author): Promise<{ id: Id<"libraryItems">; undo?: Infer<typeof saveUndo> }> {
  const { userId } = writer;
  if (rating !== undefined) requireRating(rating);
  const paper = { ...given, openalexId: canonical(given.openalexId) };
  const before = await findItem(ctx, writer.workspaceId, paper.openalexId);
  const was = await ownRating(ctx, userId, paper.openalexId);
  const id = await upsertLibraryItem(ctx, writer, paper, rating);
  const rated = rating !== undefined && rating !== was;
  // What reverses it: a paper it added is removed again, with the person's rating back as it was;
  // a rating it changed goes back. A save that changed neither has nothing to undo.
  if (!before) {
    const saved = (await ctx.db.get("libraryItems", id))!;
    return { id, undo: { path: REMOVE, args: { openalexId: paper.openalexId, expect: { savedAt: saved.savedAt, rating: rating ?? was }, ...(rated ? { rating: was } : {}) } } };
  }
  if (!rated) return { id };
  return { id, undo: { path: RATE, args: { openalexId: paper.openalexId, rating: was, expect: { savedAt: before.savedAt, rating } } } };
}

export const savedByIdValidator = v.object({ libraryItemId: v.id("libraryItems"), title: v.string(), undo: v.optional(saveUndo) });

/**
 * Saves a paper, with a rating, into a collection, or both, in one write, and says what takes
 * all of it back. Asked to save eight papers into a collection, the assistant otherwise made
 * sixteen calls, after eight that failed because the papers weren't saved yet.
 */
async function saveInto(
  ctx: MutationCtx,
  actor: Acting,
  { paper, rating, collectionId }: { paper: Infer<typeof libraryPaper>; rating?: number; collectionId?: Id<"collections"> },
) {
  const { userId, author } = actor;
  const before = await checkSave(ctx, actor, { openalexId: paper.openalexId, rating, collectionId });
  const saved = await savePaper(ctx, actor, paper, rating, author);
  const placed = collectionId === undefined ? undefined : await setPaperInCollectionAction.run(ctx, actor, { paper: { openalexId: canonical(paper.openalexId) }, collectionId, inCollection: true });
  // What takes back all of it. A paper that was saved already leaves the collection again, or gets back the rating this changed.
  // A paper this added is removed again, with the place it was given, while that place is still the one it has. One added
  // with no undo of its own (see `savePaper`) has none for its place either: half an undo would be marked as the whole.
  const undo = before
    ? (placed?.undo ?? saved.undo)
    : saved.undo?.path === REMOVE && placed?.undo
      ? { path: REMOVE, args: { ...saved.undo.args, expect: { ...saved.undo.args.expect, collectionId: placed.undo.args.collectionId, assignedAt: placed.undo.args.assignedAt } } }
      : placed
        ? undefined
        : saved.undo;
  return { id: saved.id, undo };
}
/**
 * Saves a paper whose record an action has just read from OpenAlex (./papers.ts). The read
 * took a moment, so whether the save asks the person first is checked again here, and the
 * step of the reply it is ends here, with the write: saved together or not at all.
 *
 * With `collectionId` the paper goes into that collection in the same write. Asked to save
 * eight papers into a collection, the assistant otherwise made sixteen calls, after eight
 * that failed because the papers weren't saved yet.
 */
export const saveRead = internalMutation({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), paper: libraryPaper, rating: v.optional(ratingArg), collectionId: v.optional(v.id("collections")), author: v.union(v.literal("user"), v.literal("assistant")), stepId: v.optional(v.id("assistantSteps")), approved: v.optional(v.boolean()) },
  returns: savedByIdValidator,
  handler: async (ctx, { userId, workspaceId, paper, rating, collectionId, author, stepId, approved }) => {
    // Checked again: the person may have left the workspace while the action read OpenAlex.
    const actor = await actingAs(ctx, userId, workspaceId, author);
    // Only the assistant asks: a person saving a paper themselves has decided. A collection a library follows shows the paper outside the account.
    if (author === "assistant" && !approved && collectionId !== undefined && (await followed(ctx, collectionId))) throw createError("FORBIDDEN", ASKS_FIRST);
    const { id, undo } = await saveInto(ctx, actor, { paper, rating, collectionId });
    const result = { libraryItemId: id, title: paper.title, ...(undo ? { undo } : {}) };
    if (stepId) await endStep(ctx, stepId, result);
    return result;
  },
});

export const saveToLibraryAction = defineUserMutation({
  path: "library/mutations:saveToLibrary",
  activity: ({ collectionId, title }, { undo }) => (collectionId && undo ? { kind: "collection", id: collectionId, happened: "added", count: 1, detail: title } : null),
  description:
    "Saves a paper to the library from its whole record, as a results card has it, with or without the person's own rating of it from 0 to 5, and with `collectionId` into that collection in the same write. To save a paper by its ID alone, use library/papers:save. " +
    "A person's rating of a paper is the same everywhere; a saved paper's rating is its people's average. " +
    "A save that added the paper or changed the person's rating returns `undo`: the action to run and the arguments to run it with to put things back. It is refused if the paper changed again in between.",
  args: { ...libraryPaper.fields, rating: v.optional(ratingArg), collectionId: v.optional(v.id("collections")) },
  returns: v.object({ id: v.id("libraryItems"), undo: v.optional(saveUndo) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // One into a collection a library follows, which shows the paper outside the account.
  asksFirst: async (ctx, _actor, { collectionId }) => collectionId !== undefined && (await followed(ctx, collectionId)),
  run: async (ctx, actor, { rating, collectionId, ...given }) => {
    // `paperData` is the record a results card holds, which the library page shows the paper from. The
    // assistant has no such record and made one up, which that page couldn't read: its saves keep none.
    const paper = actor.author === "assistant" ? { ...given, paperData: undefined } : given;
    const { id, undo } = await saveInto(ctx, actor, { paper, rating, collectionId });
    return { id, ...(undo ? { undo } : {}) };
  },
});
export const saveToLibrary = userMutation(saveToLibraryAction);
export const saveToLibraryForAssistant = assistantMutation(saveToLibraryAction);

export const setLibraryRatingAction = defineUserMutation({
  path: RATE,
  description:
    "Sets the person's own rating, from 0 to 5, of a paper in the library, or removes it (null). The paper stays saved. " +
    "A person's rating of a paper is the same everywhere, and a saved paper's rating is its people's average. " +
    "A change returns `undo`: the action to run and the arguments to run it with to put the rating back. It is refused if the rating changed again in between.",
  // `expect` is the person's rating as it should be now, and the save the paper should be on: a change since then refuses this one.
  args: { openalexId: v.string(), rating: ratingOrNone, expect: v.optional(ratingAsLeft) },
  returns: v.object({
    undo: v.optional(v.union(reversal(RATE, { openalexId: v.string(), rating: ratingOrNone, expect: ratingAsLeft }), reversal(CHANGE, { command: undoCommandValidator }))),
  }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, { userId, workspaceId }, { openalexId, rating, expect }) => {
    if (rating !== null) requireRating(rating);
    const item = await findItem(ctx, workspaceId, openalexId);
    const was = await ownRating(ctx, userId, openalexId);
    if (expect && (item?.savedAt !== expect.savedAt || was !== expect.rating)) throw createError("CONFLICT", "This rating has changed since then, so it was left as it is.");
    if (!item && rating !== null) throw createError("NOT_FOUND", "This paper isn't in the library, so it has no rating there.");
    await setPersonalRating(ctx, userId, openalexId, rating);
    if (was === rating) return {};
    // Clearing the rating of a paper that isn't saved here goes back as a research change.
    return item
      ? { undo: { path: RATE, args: { openalexId, rating: was, expect: { savedAt: item.savedAt, rating } } } }
      : { undo: { path: CHANGE, args: { command: { kind: "rating" as const, paperId: canonical(openalexId), rating: was, expect: rating } } } };
  },
});
export const setLibraryRating = userMutation(setLibraryRatingAction);
export const setLibraryRatingForAssistant = assistantMutation(setLibraryRatingAction);

/** The collections a removal or its undo notes in their Activity at most: a paper in more notes the first of them. */
const PLACES_NOTED = 20;

const placeNote = (id: Id<"collections">, happened: "added" | "removed", title: string) => ({ kind: "collection" as const, id, happened, count: 1, detail: title });

/** How long a removed paper is kept for Undo. */
const REMOVAL_KEPT_MS = 24 * 60 * 60_000;

/**
 * A removed paper's places one transaction moves: into its removal, or back into their
 * collections. Each takes about six reads, well within a transaction's 4,096 index ranges.
 */
const PLACES_BATCH = 250;

/**
 * Takes a batch of a removed paper out of its collections, and keeps each place in a
 * collection that still exists as one of the removal's places, for Undo. A removal undone
 * before this batch puts the place straight back on the restored paper. A deleted
 * collection's places just go. Marks the removal `moving` while batches are left.
 */
async function movePlaces(ctx: MutationCtx, removalId: Id<"libraryRemovals">) {
  const removal = (await ctx.db.get("libraryRemovals", removalId))!;
  const memberships = await ctx.db.query("libraryItemCollections").withIndex("by_item", (q) => q.eq("libraryItemId", removal.itemId)).take(PLACES_BATCH);
  const target = removal.restoredAs === undefined ? null : await ctx.db.get("libraryItems", removal.restoredAs);
  for (const membership of memberships) {
    if (!(await removeCollectionMembership(ctx, membership))) continue;
    const { collectionId, assignedAt } = membership;
    if (!target) await ctx.db.insert("removedPlaces", { removalId, collectionId, assignedAt });
    else await addCollectionMembership(ctx, { collection: (await ctx.db.get("collections", collectionId))!, item: target, assignedAt });
  }
  const more = memberships.length === PLACES_BATCH;
  if (more !== (removal.moving === true)) await ctx.db.patch("libraryRemovals", removalId, { moving: more ? true : undefined });
  return more;
}

/** A removal of this paper still putting it back in its collections, or taking an earlier copy out of them for it: removing it now would leave places behind. */
async function stillPlacing(ctx: QueryCtx, libraryItemId: Id<"libraryItems">) {
  const removal = await stream(ctx.db, schema)
    .query("libraryRemovals")
    .withIndex("by_restoredAs", (q) => q.eq("restoredAs", libraryItemId))
    .filterWith(async (row) => row.moving === true || row.placing === true)
    .first();
  return removal !== null;
}

export const removeFromLibraryAction = defineUserMutation({
  path: "library/mutations:removeFromLibrary",
  description:
    "Removes a paper from the library, with its place in every collection; the person's own rating of it stays. " +
    "With `rating`, their own rating goes back to it too (null clears it): the undo of a save that rated the paper. " +
    "Returns `undo`: the action to run and the arguments to run it with to put the paper back, within a day.",
  // `expect` is the paper as the save being undone left it: one rated, put in a collection or saved afresh since then stays.
  args: { openalexId: v.string(), expect: v.optional(ratingAsLeft), rating: v.optional(ratingOrNone) },
  returns: v.object({ undo: reversedBy(RESTORE, { removalId: v.id("libraryRemovals") }) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The paper leaves its collections too, and a library may follow one of them.
  asksFirst: async (ctx, { workspaceId }, args) => {
    const item = await findItem(ctx, workspaceId, args.openalexId);
    return item !== null && (await inFollowedCollection(ctx, item._id));
  },
  run: async (ctx, actor, args) => {
    const { userId, workspaceId, author } = actor;
    if (args.rating != null) requireRating(args.rating);
    const item = await findItem(ctx, workspaceId, args.openalexId);
    if (!item) return {};
    requireMakerOrAdmin(actor, item.createdBy);
    if (await stillPlacing(ctx, item._id)) throw createError("CONFLICT", "This paper is still going back into its collections. Try again in a moment.");
    // Undoing a save leaves a paper that isn't as the save left it: the same save, with the
    // person's rating as it left it, in no collection.
    // The paper's places have to be as the save being undone left them: none, or the one it gave. Another place, that one
    // given again since, or that one taken away since, is a change the person made after it.
    if (args.expect) {
      const places = await livePlaces(ctx, item._id).take(2);
      const asSaved = args.expect.collectionId === undefined ? places.length === 0 : places.length === 1 && places[0].collectionId === args.expect.collectionId && places[0].assignedAt === args.expect.assignedAt;
      if (!asSaved || item.savedAt !== args.expect.savedAt || (await ownRating(ctx, userId, item.openalexId)) !== args.expect.rating) {
        throw createError("CONFLICT", "This paper has changed since then, so it was left in the library.");
      }
    }
    const { _id, _creationTime, workspaceId: _workspace, ...kept } = item;
    const expiresAt = Date.now() + REMOVAL_KEPT_MS;
    // The collections it leaves note it in their Activity (#656), read before its places move.
    const left = await livePlaces(ctx, item._id).take(PLACES_NOTED);
    const removalId = await ctx.db.insert("libraryRemovals", { workspaceId, item: kept, itemId: item._id, expiresAt });
    // Its places in collections: this batch now, the rest in the batches it schedules.
    if (await movePlaces(ctx, removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.movePlacesLater, { removalId });
    await countedWrite(ctx, { userId, workspaceId }, -1, () => ctx.db.delete("libraryItems", item._id));
    if (args.rating !== undefined) await setPersonalRating(ctx, userId, item.openalexId, args.rating);
    await ctx.scheduler.runAt(expiresAt, internal.library.mutations.forgetRemoval, { removalId });
    await noteActivity(ctx, { workspaceId, by: userId, viaAssistant: author === "assistant" }, left.map(({ collectionId }) => placeNote(collectionId, "removed", item.title)));
    return { undo: { path: RESTORE, args: { removalId } } };
  },
});
export const removeFromLibrary = userMutation(removeFromLibraryAction);
export const removeFromLibraryForAssistant = assistantMutation(removeFromLibraryAction);

/** Moves the next batch of a removed paper's places into its removal, until none are left. */
/** Brings an organization's copy of a paper, or its place in a collection, in step with its members' ratings (../ratings.ts). */
export const rerate = internalMutation({
  args: { workspaceId: v.id("workspaces"), paperId: v.string(), collectionId: v.optional(v.id("collections")) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, paperId, collectionId }) => {
    await rerateCopy(ctx, workspaceId, paperId, collectionId);
    return null;
  },
});

/** Re-rates the papers a person rated in an organization they joined or left, a step at a time (../ratings.ts). */
export const rerateMember = internalMutation({
  args: { workspaceId: v.id("workspaces"), userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, userId, cursor }) => {
    await rerateMemberStep(ctx, workspaceId, userId, cursor);
    return null;
  },
});

export const movePlacesLater = internalMutation({
  args: { removalId: v.id("libraryRemovals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Its day for Undo may be over: what's left of the paper's places just goes, a batch at a time.
    if (!(await ctx.db.get("libraryRemovals", args.removalId))) return null;
    if (await movePlaces(ctx, args.removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.movePlacesLater, args);
    return null;
  },
});

/** How long a removal's end waits for its places still moving: batches follow one another at once. */
const PLACES_WAIT_MS = 60_000;

/** Deletes a removal once its day for Undo is over, and its places a batch at a time. Waits while its places are still moving, so none are left behind. */
export const forgetRemoval = internalMutation({
  args: { removalId: v.id("libraryRemovals") },
  returns: v.null(),
  handler: async (ctx, { removalId }) => {
    const removal = await ctx.db.get("libraryRemovals", removalId);
    if (removal?.moving || removal?.placing) return void (await ctx.scheduler.runAfter(PLACES_WAIT_MS, internal.library.mutations.forgetRemoval, { removalId }));
    if (removal) await ctx.db.delete("libraryRemovals", removalId);
    const places = await ctx.db.query("removedPlaces").withIndex("by_removal", (q) => q.eq("removalId", removalId)).take(PLACES_BATCH);
    for (const place of places) await ctx.db.delete("removedPlaces", place._id);
    if (places.length === PLACES_BATCH) await ctx.scheduler.runAfter(0, internal.library.mutations.forgetRemoval, { removalId });
    return null;
  },
});

/** Puts a batch of a removal's places back on the restored paper, in the person's collections that still exist. Marks the removal `placing` while batches are left. */
async function restorePlaces(ctx: MutationCtx, removalId: Id<"libraryRemovals">) {
  const removal = (await ctx.db.get("libraryRemovals", removalId))!;
  const item = (await ctx.db.get("libraryItems", removal.restoredAs!))!;
  const places = await ctx.db.query("removedPlaces").withIndex("by_removal", (q) => q.eq("removalId", removalId)).take(PLACES_BATCH);
  for (const place of places) {
    const collection = await ctx.db.get("collections", place.collectionId);
    // Collections deleted since the removal stay deleted.
    if (collection !== null && collection.workspaceId === removal.workspaceId) await addCollectionMembership(ctx, { collection, item, assignedAt: place.assignedAt });
    await ctx.db.delete("removedPlaces", place._id);
  }
  const more = places.length === PLACES_BATCH;
  if (more !== (removal.placing === true)) await ctx.db.patch("libraryRemovals", removalId, { placing: more ? true : undefined });
  return more;
}

/** Puts the next batch of a restored paper's places back, until none are left. The paper can't be removed again meanwhile (`stillPlacing`). */
export const restorePlacesLater = internalMutation({
  args: { removalId: v.id("libraryRemovals") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.db.get("libraryRemovals", args.removalId))) return null;
    if (await restorePlaces(ctx, args.removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.restorePlacesLater, args);
    return null;
  },
});

export const restoreLibraryItemAction = defineUserMutation({
  path: "library/mutations:restoreLibraryItem",
  description:
    "Puts back a paper that removeFromLibrary removed, given that removal's ID, with its saved date and its place in the collections that still exist; its rating is its people's average as it is now. Works once, within a day of the removal. " +
    "It is itself the undo of a removal and returns none: removing the paper again is a new removal, with its own undo.",
  args: { removalId: v.id("libraryRemovals") },
  returns: v.object({ id: v.id("libraryItems") }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The paper goes back into its collections, and a library may follow one of them.
  asksFirst: async (ctx, _actor, { removalId }) => {
    const place = await stream(ctx.db, schema)
      .query("removedPlaces")
      .withIndex("by_removal", (q) => q.eq("removalId", removalId))
      .filterWith((row) => followed(ctx, row.collectionId))
      .first();
    if (place !== null) return true;
    // Places still being moved off the removed paper come back too.
    const removal = await ctx.db.get("libraryRemovals", removalId);
    return removal?.moving === true && (await inFollowedCollection(ctx, removal.itemId));
  },
  run: async (ctx, { userId, workspaceId, author }, { removalId }) => {
    const removal = await ctx.db.get("libraryRemovals", removalId);
    // Its day is over even if the cleanup hasn't reached it yet.
    if (!removal || removal.workspaceId !== workspaceId || removal.restoredAs !== undefined || removal.expiresAt <= Date.now()) throw createError("NOT_FOUND", "This removal can no longer be undone.");
    const { item } = removal;
    const existing = await findItem(ctx, workspaceId, item.openalexId);
    let libraryItemId: Id<"libraryItems">;
    if (existing) {
      // Saved again before Undo: that copy stays.
      libraryItemId = existing._id;
    } else {
      // Back in the workspace Undo runs in, made by whoever first saved it, rated as its people rate it now.
      libraryItemId = await countedWrite(ctx, { userId, workspaceId }, 1, () => ctx.db.insert("libraryItems", { ...item, workspaceId, updatedAt: Date.now() }));
      await rateItem(ctx, (await ctx.db.get("libraryItems", libraryItemId))!);
    }
    // Kept until its day is over, so places still being moved off the removed paper come back too.
    await ctx.db.patch("libraryRemovals", removalId, { restoredAs: libraryItemId });
    // The collections it goes back into note it in their Activity (#656), read before its places do.
    const back = await ctx.db.query("removedPlaces").withIndex("by_removal", (q) => q.eq("removalId", removalId)).take(PLACES_NOTED);
    // Its places: this batch now, the rest in the batches it schedules.
    if (await restorePlaces(ctx, removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.restorePlacesLater, { removalId });
    const kept = await Promise.all(back.map(async ({ collectionId }) => ((await ctx.db.get("collections", collectionId))?.workspaceId === workspaceId ? collectionId : null)));
    await noteActivity(ctx, { workspaceId, by: userId, viaAssistant: author === "assistant" }, kept.filter((id) => id !== null).map((id) => placeNote(id, "added", item.title)));
    return { id: libraryItemId };
  },
});
export const restoreLibraryItem = userMutation(restoreLibraryItemAction);
export const restoreLibraryItemForAssistant = assistantMutation(restoreLibraryItemAction);

export const setPaperInCollectionAction = defineUserMutation({
  path: "library/mutations:setPaperInCollection",
  activity: ({ paper, collectionId, inCollection }, { undo }) => (undo ? { kind: "collection", id: collectionId, happened: inCollection ? "added" : "removed", count: 1, ...("title" in paper ? { detail: paper.title } : {}) } : null),
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
  asksFirst: (ctx, _actor, { collectionId }) => followed(ctx, collectionId),
  run: async (ctx, { userId, workspaceId }, { paper, collectionId, inCollection, assignedAt }) => {
    const collection = await ownedCollection(ctx, workspaceId, collectionId);
    const whole = "title" in paper;
    const item = whole && inCollection ? await ctx.db.get("libraryItems", await upsertLibraryItem(ctx, { userId, workspaceId }, paper)) : await findItem(ctx, workspaceId, paper.openalexId);
    if (!whole && paper.savedAt !== undefined && item && item.savedAt !== paper.savedAt) throw createError("CONFLICT", "This paper was removed and saved again since then, so the collection was left as it is.");
    // Only a change has an undo, so undoing never touches a paper that was already in, or already
    // out. It names the save and the place in the collection it's for.
    const reverse = (at: number) => ({ undo: { path: IN_COLLECTION, args: { paper: { openalexId: paper.openalexId, savedAt: item!.savedAt }, collectionId, inCollection: !inCollection, assignedAt: at } } });
    if (inCollection) {
      if (!item) throw createError("NOT_FOUND", "This paper is no longer in the library.");
      const at = await addCollectionMembership(ctx, { collection, item, assignedAt });
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
