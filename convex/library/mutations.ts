import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { stream } from "convex-helpers/server/stream";
import schema from "../schema";
import { internalMutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { ASKS_FIRST, actingAs, assistantMutation, defineUserMutation, reversal, reversedBy, userMutation, type Acting, type Author } from "../lib/userActions";
import { personalWorkspaceOf, requireMakerOrAdmin, type InWorkspace } from "../workspaces/actor";
import { endStep } from "../assistant/steps";
import { applyRating } from "../research/records";
import { undoCommandValidator } from "../../lib/research/records";
import { workUrl } from "../../lib/openalex/work-id";
import { libraryCountRow } from "./counter";
import { addCollectionMembership, livePlaces, removeCollectionMembership } from "./collectionMembership";
import { followed, inFollowedCollection } from "./followed";
import { authorDisplay, mergePaperMetadata } from "../../lib/library/paper-metadata";
import { MAX_AUTHORS } from "../lib/listCaps";

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
const ratingOrNone = v.union(ratingArg, v.null());
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

function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

/** A paper's ID as the library keeps it. The assistant gives the bare ID as often as the whole one, and both are the same paper. */
export const canonical = (openalexId: string) => workUrl(openalexId) ?? openalexId;

/** A workspace's saved paper by its ID. One saved under the ID as it was given, before the library kept one form, is still found by that. */
export async function findItem(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, openalexId: string) {
  const byId = (id: string) => ctx.db.query("libraryItems").withIndex("by_workspace_openalexId", (q) => q.eq("workspaceId", workspaceId).eq("openalexId", id)).unique();
  const kept = canonical(openalexId);
  const ids = new Set([kept, openalexId, workUrl(openalexId)?.split("/").at(-1)]);
  for (const id of ids) {
    if (!id) continue;
    const item = await byId(id);
    if (item) return item;
  }
  return null;
}

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
 * Saves a paper to the person's library, or updates the copy already there. A rating
 * replaces the saved one; without one, a new paper is saved unrated and a saved
 * paper keeps its rating. Screening saves qualified papers through here too.
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
  if (existing) {
    await ctx.db.patch("libraryItems", existing._id, {
      ...merged,
      ...(rating !== undefined && !options.preserveRating && { rating }),
      searchableText,
      updatedAt: Date.now(),
    });
    return existing._id;
  }
  const now = Date.now();
  return await countedWrite(ctx, writer, 1, () =>
    ctx.db.insert("libraryItems", {
      workspaceId,
      createdBy: userId,
      ...paper,
      ...merged,
      metadataVersion: 2,
      // Every writer saves through here, so a paper has one row whatever form its ID came in.
      openalexId: canonical(paper.openalexId),
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
function setResearchRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null, expect?: number | null) {
  return applyRating(ctx, userId, { kind: "rating", paperId: canonical(paperId), rating, ...(expect === undefined ? {} : { expect }) });
}

/** The paper's rating on search cards, or null. */
async function researchRating(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) {
  return (await ctx.db.query("paperRatings").withIndex("by_user_and_paperId", (q) => q.eq("userId", userId).eq("data.paperId", canonical(paperId))).unique())?.data.rating ?? null;
}

async function ownedCollection(ctx: MutationCtx, workspaceId: Id<"workspaces">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  if (!collection) throw createError("NOT_FOUND", "This collection no longer exists.");
  if (collection.workspaceId !== workspaceId) throw createError("FORBIDDEN", "Not your collection");
  return collection;
}

/** What takes a paper out of a collection again, or puts it back: the undo of a change to its place there. */
const placeUndo = reversal(IN_COLLECTION, { paper: savedPaper, collectionId: v.id("collections"), inCollection: v.boolean(), assignedAt: v.number() });
const saveUndo = v.union(reversal(REMOVE, { openalexId: v.string(), expect: ratingAsLeft }), reversal(RATE, { openalexId: v.string(), rating: ratingOrNone, expect: ratingAsLeft }), placeUndo);

/** Whether a save asks the person first: one whose undo would lose the rating the paper has on search cards (see `savePaper`). */
export async function saveAsksFirst(ctx: Pick<QueryCtx, "db">, { userId, workspaceId }: InWorkspace, openalexId: string, rating: number | undefined) {
  const [item, onCards] = [await findItem(ctx, workspaceId, openalexId), await researchRating(ctx, userId, openalexId)];
  if (!item) return onCards !== null;
  const was = item.rating ?? null;
  return rating !== undefined && rating !== was && onCards !== was;
}

/** Saves a paper, rated when a rating is given, and says what reverses it. */
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
  if (before && collectionId !== undefined && rating !== undefined && (rating !== (before.rating ?? null) || rating !== (await researchRating(ctx, userId, canonical(openalexId))))) {
    throw createError("VALIDATION_ERROR", "This paper is already saved. Rate it with library/mutations:setLibraryRating and put it in the collection with library/papers:collect, one change at a time, so each can be undone.");
  }
  return before;
}

async function savePaper(ctx: MutationCtx, writer: InWorkspace, given: Infer<typeof libraryPaper>, rating: number | undefined, author: Author): Promise<{ id: Id<"libraryItems">; undo?: Infer<typeof saveUndo> }> {
  const { userId } = writer;
  if (rating !== undefined) requireRating(rating);
  const paper = { ...given, openalexId: canonical(given.openalexId) };
  const before = await findItem(ctx, writer.workspaceId, paper.openalexId);
  const onCards = await researchRating(ctx, userId, paper.openalexId);
  const id = await upsertLibraryItem(ctx, writer, paper, rating);
  if (rating !== undefined) await setResearchRating(ctx, userId, paper.openalexId, rating);
  // What reverses it: a paper it added is removed again, and a rating it changed goes back.
  // A save that changed neither has nothing to undo. Nor has one whose undo would lose the
  // rating the paper had on search cards: removing a paper clears that rating, and a rating
  // put back is put back in both places.
  if (!before) {
    if (onCards !== null) return { id };
    const saved = (await ctx.db.get("libraryItems", id))!;
    return { id, undo: { path: REMOVE, args: { openalexId: paper.openalexId, expect: { savedAt: saved.savedAt, rating: rating ?? null } } } };
  }
  const was = before.rating ?? null;
  if (rating === undefined || rating === was || onCards !== was) return { id };
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
  // `workspaceId` is optional only for a call from an action already running when this deployed (#650), which saves into its person's own; required again in slice 8.
  args: { userId: v.id("users"), workspaceId: v.optional(v.id("workspaces")), paper: libraryPaper, rating: v.optional(ratingArg), collectionId: v.optional(v.id("collections")), author: v.union(v.literal("user"), v.literal("assistant")), stepId: v.optional(v.id("assistantSteps")), approved: v.optional(v.boolean()) },
  returns: savedByIdValidator,
  handler: async (ctx, { userId, workspaceId, paper, rating, collectionId, author, stepId, approved }) => {
    // Checked again: the person may have left the workspace while the action read OpenAlex.
    const actor = await actingAs(ctx, userId, workspaceId ?? (await personalWorkspaceOf(ctx, userId)), author);
    // Only the assistant asks: a person saving a paper themselves has decided. A collection a library follows shows the paper outside the account.
    if (author === "assistant" && !approved && ((await saveAsksFirst(ctx, actor, paper.openalexId, rating)) || (collectionId !== undefined && (await followed(ctx, collectionId))))) throw createError("FORBIDDEN", ASKS_FIRST);
    const { id, undo } = await saveInto(ctx, actor, { paper, rating, collectionId });
    const result = { libraryItemId: id, title: paper.title, ...(undo ? { undo } : {}) };
    if (stepId) await endStep(ctx, stepId, result);
    return result;
  },
});

export const saveToLibraryAction = defineUserMutation({
  path: "library/mutations:saveToLibrary",
  description:
    "Saves a paper to the person's library from its whole record, as a results card has it, with or without a rating from 0 to 5, and with `collectionId` into that collection of theirs in the same write. To save a paper by its ID alone, use library/papers:save. Saving a paper that's already there updates its rating when one is given and otherwise keeps it. " +
    "A save that added the paper or changed its rating returns `undo`: the action to run and the arguments to run it with to put things back. It is refused if the paper changed again in between. " +
    "A save has no undo when the paper carried a different rating on search cards, which undoing would lose.",
  args: { ...libraryPaper.fields, rating: v.optional(ratingArg), collectionId: v.optional(v.id("collections")) },
  returns: v.object({ id: v.id("libraryItems"), undo: v.optional(saveUndo) }),
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  // The saves that return no undo (see `run`): one whose undo would lose the rating the paper has on search cards.
  // And one into a collection a library follows, which shows the paper outside the account.
  asksFirst: async (ctx, actor, { rating, openalexId, collectionId }) => (await saveAsksFirst(ctx, actor, openalexId, rating)) || (collectionId !== undefined && (await followed(ctx, collectionId))),
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
  asksFirst: async (ctx, { userId, workspaceId }, { openalexId, rating }) => {
    const item = await findItem(ctx, workspaceId, openalexId);
    const was = item?.rating ?? null;
    return item !== null && was !== rating && (await researchRating(ctx, userId, openalexId)) !== was;
  },
  run: async (ctx, { userId, workspaceId, author }, { openalexId, rating, expect }) => {
    if (rating !== null) requireRating(rating);
    const item = await findItem(ctx, workspaceId, openalexId);
    const was = item?.rating ?? null;
    if (expect && (item?.savedAt !== expect.savedAt || was !== expect.rating)) throw createError("CONFLICT", "This rating has changed since then, so it was left as it is.");
    if (!item && rating !== null) throw createError("NOT_FOUND", "This paper isn't in the library, so it has no rating there.");
    const onCards = await researchRating(ctx, userId, openalexId);
    const changed = item !== null && was !== rating;
    if (changed) await ctx.db.patch("libraryItems", item._id, { rating: rating ?? undefined, updatedAt: Date.now() });
    // An undo expects the rating on search cards to be the one it replaces, too.
    const cards = await setResearchRating(ctx, userId, openalexId, rating, expect?.rating);
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
    "Removes a paper from the person's library, with its rating and its place in every collection. " +
    "Returns `undo`: the action to run and the arguments to run it with to put the paper back, within a day.",
  // `expect` is the paper as the save being undone left it: one rated, put in a collection or saved afresh since then stays.
  args: { openalexId: v.string(), expect: v.optional(ratingAsLeft) },
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
    const item = await findItem(ctx, workspaceId, args.openalexId);
    if (!item) return {};
    requireMakerOrAdmin(actor, item.createdBy);
    if (await stillPlacing(ctx, item._id)) throw createError("CONFLICT", "This paper is still going back into its collections. Try again in a moment.");
    // Undoing a save leaves a paper that isn't as the save left it: the same save, with that
    // rating in the library and on search cards, in no collection.
    // The paper's places have to be as the save being undone left them: none, or the one it gave. Another place, that one
    // given again since, or that one taken away since, is a change the person made after it.
    if (args.expect) {
      const places = await livePlaces(ctx, item._id).take(2);
      const asSaved = args.expect.collectionId === undefined ? places.length === 0 : places.length === 1 && places[0].collectionId === args.expect.collectionId && places[0].assignedAt === args.expect.assignedAt;
      if (!asSaved || item.savedAt !== args.expect.savedAt || (item.rating ?? null) !== args.expect.rating || (await researchRating(ctx, userId, item.openalexId)) !== args.expect.rating) {
        throw createError("CONFLICT", "This paper has changed since then, so it was left in the library.");
      }
    }
    const { _id, _creationTime, userId: _owner, workspaceId: _workspace, ...kept } = item;
    const expiresAt = Date.now() + REMOVAL_KEPT_MS;
    const removalId = await ctx.db.insert("libraryRemovals", { workspaceId, item: kept, itemId: item._id, expiresAt });
    // Its places in collections: this batch now, the rest in the batches it schedules.
    if (await movePlaces(ctx, removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.movePlacesLater, { removalId });
    await countedWrite(ctx, { userId, workspaceId }, -1, () => ctx.db.delete("libraryItems", item._id));
    await setResearchRating(ctx, userId, item.openalexId, null);
    await ctx.scheduler.runAt(expiresAt, internal.library.mutations.forgetRemoval, { removalId });
    return { undo: { path: RESTORE, args: { removalId } } };
  },
});
export const removeFromLibrary = userMutation(removeFromLibraryAction);
export const removeFromLibraryForAssistant = assistantMutation(removeFromLibraryAction);

/** Moves the next batch of a removed paper's places into its removal, until none are left. */
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
    "Puts back a paper that removeFromLibrary removed, given that removal's ID, with its rating, its saved date and its place in the collections that still exist. Works once, within a day of the removal. " +
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
      // Saved again before Undo: keep that copy and bring back the old rating if it has none.
      libraryItemId = existing._id;
      if (existing.rating === undefined && item.rating !== undefined) {
        await ctx.db.patch("libraryItems", existing._id, { rating: item.rating, updatedAt: Date.now() });
        await setResearchRating(ctx, userId, item.openalexId, item.rating);
      }
    } else {
      // Back in the workspace Undo runs in, made by whoever first saved it.
      libraryItemId = await countedWrite(ctx, { userId, workspaceId }, 1, () =>
        ctx.db.insert("libraryItems", { ...item, workspaceId, createdBy: item.createdBy ?? userId, updatedAt: Date.now() }),
      );
      if (item.rating !== undefined) await setResearchRating(ctx, userId, item.openalexId, item.rating);
    }
    // Kept until its day is over, so places still being moved off the removed paper come back too.
    await ctx.db.patch("libraryRemovals", removalId, { restoredAs: libraryItemId });
    // Its places: this batch now, the rest in the batches it schedules.
    if (await restorePlaces(ctx, removalId)) await ctx.scheduler.runAfter(0, internal.library.mutations.restorePlacesLater, { removalId });
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
