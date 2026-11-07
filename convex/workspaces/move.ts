// Moving an item to another of the person's workspaces (#654): a collection with its papers, a
// search with its screening answers, its screenings and its history, a finished screening of a
// collection, the library or another screening, a finished extraction job, a chat they started,
// an author profile, or a community (#1092). Its activity goes with it and records where it came
// from; the person goes with it too.

import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "../lib/functions";
import { createError } from "../lib/errors";
import { assistantMutation, assistantQuery, defineUserMutation, defineUserQuery, userMutation, userQuery, type Acting } from "../lib/userActions";
import { findSearch, writtenOut } from "../research/records";
import { screeningFor } from "../research/answers";
import { noteActivity } from "../activity/notes";
import { itemKey } from "../activity/validators";
import { planLimit } from "../billing/accounts";
import { collectionCountRow } from "../library/counter";
import { facetsOf } from "../library/facets";
import { removeCollectionMembership } from "../library/collectionMembership";
import { MAX_LIBRARIES_PER_WORKSPACE, MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { countOf, workspaceLibrariesOf } from "../lib/listCounts";
import { createsIn } from "../organizationFeatures";
import { collectionRatingRow, personalRatingRow, placeOf, placeRated, setPersonalRating, writeRating } from "../ratings";
import { libraryPaper, upsertLibraryItem } from "../library/mutations";
import { requireAuthorProfiles } from "../authors/profiles";
import { MAKERS, profileMaker } from "../authors/access";
import { give } from "../sharing/access";
import { actorIn } from "./actor";
import { workspaceName } from "./personal";

export const movableKinds = ["collection", "search", "screening", "extraction", "chat", "author", "community"] as const;
export type Movable = (typeof movableKinds)[number];

/** A job moves once it has finished: until then its credits are held by the workspace it runs in. */
const FINISHED = new Set(["completed", "cancelled", "failed"]);
/** A screening that stopped at its spending limit or out of credits has finished too; an extraction's can be resumed. */
const SCREENING_FINISHED = new Set([...FINISHED, "creditsExhausted"]);

/** Activity rows one step moves with their item. */
const ACTIVITY_STEP = 200;

/** Screenings of one search a move takes with it; a search with more stays where it is. */
const SEARCH_SCREENINGS_MOVED = 200;

/** A moved collection's papers one step saves to its new workspace's library, at most. */
const PAPERS_STEP = 100;
/**
 * The queries one step may spend on its papers, under Convex's 4,096 a transaction: in an
 * organization each paper reads every member's rating of it, for its library and its place.
 */
const PAPERS_STEP_QUERIES = 3_000;
/**
 * The characters of papers one step may read, which keeps it under Convex's 16 MiB a
 * transaction: a paper is read where it was and twice where it goes, a character takes three
 * bytes at most, and the step ends after the paper that passes this.
 */
const PAPERS_STEP_CHARS = 2_000_000;

type Read = Pick<QueryCtx, "db">;

const inWorkspace = <T extends { workspaceId: Id<"workspaces"> }>(row: T | null, workspaceId: Id<"workspaces">) => (row?.workspaceId === workspaceId ? row : null);

const screeningJobIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const jobId = ctx.db.normalizeId("screeningJobs", id);
  return inWorkspace(jobId ? await ctx.db.get("screeningJobs", jobId) : null, workspaceId);
};
const extractionJobIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const jobId = ctx.db.normalizeId("extractionJobs", id);
  return inWorkspace(jobId ? await ctx.db.get("extractionJobs", jobId) : null, workspaceId);
};
const collectionIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const collectionId = ctx.db.normalizeId("collections", id);
  return inWorkspace(collectionId ? await ctx.db.get("collections", collectionId) : null, workspaceId);
};
const profileIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const profileId = ctx.db.normalizeId("authorProfiles", id);
  const profile = profileId ? await ctx.db.get("authorProfiles", profileId) : null;
  return profile?.workspaceId === workspaceId ? profile : null;
};
const communityIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const libraryId = ctx.db.normalizeId("evidenceLibraries", id);
  return inWorkspace(libraryId ? await ctx.db.get("evidenceLibraries", libraryId) : null, workspaceId);
};
const chatIn = async (ctx: Read, workspaceId: Id<"workspaces">, id: string) => {
  const threadId = ctx.db.normalizeId("assistantThreads", id);
  return inWorkspace(threadId ? await ctx.db.get("assistantThreads", threadId) : null, workspaceId);
};

/**
 * Whether a screening has stopped working: it has ended, none of its papers is still being read
 * or waiting for a slot, and none waits for the bookkeeping that frees its workspace's slots.
 */
async function screeningSettled(ctx: Read, job: Doc<"screeningJobs">) {
  if (!SCREENING_FINISHED.has(job.status)) return false;
  const reading = await ctx.db.query("screeningResults").withIndex("by_job_and_status_and_waitingWorkspace", (q) => q.eq("jobId", job._id).eq("status", "processing")).first();
  const unkept = await ctx.db.query("screeningResults").withIndex("by_job_and_doneAt", (q) => q.eq("jobId", job._id).gte("doneAt", 0n)).first();
  return !reading && !unkept;
}

/** A search's screening answers and the screenings that wrote them, which go where it goes; `jobs` is null past SEARCH_SCREENINGS_MOVED. */
async function screeningsOf(ctx: Read, search: Doc<"searches">) {
  const screening = await screeningFor(ctx, search._id);
  if (!screening) return { screening: null, jobs: [] };
  const jobs = await ctx.db.query("screeningJobs").withIndex("by_screening", (q) => q.eq("screeningId", screening._id)).take(SEARCH_SCREENINGS_MOVED + 1);
  return { screening, jobs: jobs.length > SEARCH_SCREENINGS_MOVED ? null : jobs };
}

/**
 * Why the item can't move, the first reason that holds, or null: only an organization's admins
 * move its work out of it (#654), a job or a chat waits until it's done, and a search's screening
 * goes with its search.
 */
export async function heldBack(ctx: Read, { workspaceId, role, userId }: Pick<Acting, "workspaceId" | "role" | "userId">, kind: Movable, id: string): Promise<string | null> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (workspace?.kind === "organization" && role !== "admin") return `Only ${await workspaceName(ctx, workspaceId)}'s admins move its work out of it.`;
  const gone = "It isn't in this workspace any more.";
  if (kind === "collection") {
    const collection = await collectionIn(ctx, workspaceId, id);
    if (!collection) return gone;
    // A library shows the papers of the collections it follows, from the workspace they're in.
    const follower = await ctx.db.query("evidenceLibraryCollectionSources").withIndex("by_collectionId", (q) => q.eq("collectionId", collection._id)).first();
    if (follower) return `${(await ctx.db.get("evidenceLibraries", follower.libraryId))?.name ?? "An Evidence Community"} follows this collection. Stop following it in the community's sources first.`;
  } else if (kind === "author") {
    if (!(await profileIn(ctx, workspaceId, id))) return gone;
  } else if (kind === "search") {
    const search = await findSearch(ctx, workspaceId, id);
    if (!search) return gone;
    const { jobs } = await screeningsOf(ctx, search);
    if (jobs === null) return `A search with more than ${SEARCH_SCREENINGS_MOVED} screenings stays where it is.`;
    for (const job of jobs) if (!(await screeningSettled(ctx, job))) return "A screening of this search is still running. It moves once that has finished.";
  } else if (kind === "screening") {
    const job = await screeningJobIn(ctx, workspaceId, id);
    if (!job) return gone;
    const searchId = (await ctx.db.get("screenings", job.screeningId))?.searchId;
    if (searchId) return `It screens the search "${(await ctx.db.get("searches", searchId))?.data.query ?? ""}". Move the search, and its screenings go with it.`;
    if (!(await screeningSettled(ctx, job))) return "A running screening moves once it has finished.";
  } else if (kind === "extraction") {
    const job = await extractionJobIn(ctx, workspaceId, id);
    if (!job) return gone;
    if (!FINISHED.has(job.status ?? "")) return "A running extraction moves once it has finished.";
  } else if (kind === "community") {
    const community = await communityIn(ctx, workspaceId, id);
    if (!community) return gone;
    if (community.state === "disabled") return "A community being deleted stays where it is.";
    // A setup, publish or update running on it, or waiting to try again, started in this workspace and finishes here.
    const running = await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_status_and_updatedAt", (q) => q.eq("libraryId", community._id).eq("status", "running")).first();
    const retrying = await ctx.db.query("evidenceLibraryConfigOperations").withIndex("by_libraryId_and_status_and_attemptCount", (q) => q.eq("libraryId", community._id).eq("status", "queued").gt("attemptCount", 0)).first();
    if (running || retrying) return "A community moves once the change running on it has finished.";
  } else {
    const thread = await chatIn(ctx, workspaceId, id);
    if (!thread) return gone;
    if (thread.createdBy !== userId) return "Only the person who started a chat moves it.";
    // A reply being written, or one waiting on a question or at a spending limit, carries on where it started.
    if (thread.reply || thread.asking) return "A chat moves once its reply has finished.";
  }
  return null;
}

/** Puts the item, and what's stored with it by its workspace, in `to`; returns the row its activity follows. */
async function rehome(ctx: MutationCtx, by: Id<"users">, from: Id<"workspaces">, to: Id<"workspaces">, kind: Movable, id: string): Promise<{ table: Followed; id: string } | null> {
  if (kind === "collection") {
    const collection = await collectionIn(ctx, from, id);
    if (!collection) throw createError("NOT_FOUND", "Collection not found");
    const most = await planLimit(ctx, to, "collections");
    const there = await collectionCountRow(ctx, to);
    if (most !== undefined && (there?.count ?? 0) >= most) throw createError("VALIDATION_ERROR", `${await workspaceName(ctx, to)}'s plan allows ${most.toLocaleString("en")} collections, and it has them all.`);
    await ctx.db.patch("collections", collection._id, { workspaceId: to });
    const here = await collectionCountRow(ctx, from);
    if (here) await ctx.db.patch("collectionCounts", here._id, { count: Math.max(0, here.count - 1) });
    if (there) await ctx.db.patch("collectionCounts", there._id, { count: there.count + 1 });
    else await ctx.db.insert("collectionCounts", { workspaceId: to, count: 1 });
    // Its papers are saved to its new workspace's library a step at a time; the library it left keeps them.
    await ctx.scheduler.runAfter(0, internal.workspaces.move.moveCollectionPapers, { collectionId: collection._id, by, from: 0 });
    return { table: "collections", id: collection._id };
  }
  if (kind === "author") {
    const profile = await profileIn(ctx, from, id);
    if (!profile) throw createError("NOT_FOUND", "Author profile not found");
    await requireAuthorProfiles(ctx, to);
    // It goes where the person may make one (#1093), and they edit it there when they don't run that workspace.
    const person = await ctx.db.get("users", by);
    const may = person ? await profileMaker(ctx, person, to) : null;
    if (!person || !may) throw createError("FORBIDDEN", MAKERS);
    // Its publications and editors are its own, by its ID.
    await ctx.db.patch("authorProfiles", profile._id, { workspaceId: to });
    if (!may.runs) await give(ctx, { kind: "author", id: profile._id, workspaceId: to, name: profile.name, createdBy: profile.createdBy }, person, "editor", { userId: by, author: "user" });
    return { table: "authorProfiles", id: profile._id };
  }
  if (kind === "search") {
    const search = await findSearch(ctx, from, id);
    if (!search) throw createError("NOT_FOUND", "Search not found");
    if (await findSearch(ctx, to, id)) throw createError("CONFLICT", "That workspace has this search already.");
    // The bookmarks its query names are the workspace's it leaves: written out, it goes on searching for what it did.
    const query = await writtenOut(ctx, search, search.data.query);
    await ctx.db.patch("searches", search._id, { workspaceId: to, ...(query === search.data.query ? {} : { data: { ...search.data, query } }) });
    // Its answers and the screenings that wrote them go with it; the papers they saved stay in the library they went to.
    const { screening, jobs } = await screeningsOf(ctx, search);
    if (screening) await ctx.db.patch("screenings", screening._id, { workspaceId: to });
    for (const job of jobs ?? []) await ctx.db.patch("screeningJobs", job._id, { workspaceId: to, targetCollectionId: undefined });
    return { table: "searches", id: search._id };
  }
  if (kind === "screening") {
    const job = await screeningJobIn(ctx, from, id);
    if (!job) throw createError("NOT_FOUND", "Screening not found");
    // Its answers are its own; the collection its papers went to stays where it is, with them.
    await ctx.db.patch("screeningJobs", job._id, { workspaceId: to, targetCollectionId: undefined });
    await ctx.db.patch("screenings", job.screeningId, { workspaceId: to });
    return { table: "screeningJobs", id: job._id };
  }
  if (kind === "community") {
    const community = await communityIn(ctx, from, id);
    if (!community) throw createError("NOT_FOUND", "Community not found");
    const [person, target] = await Promise.all([ctx.db.get("users", by), ctx.db.get("workspaces", to)]);
    if (!person || !target || !(await createsIn(ctx, person, target))) throw createError("FORBIDDEN", "A community moves to your own workspace or an organization you're an admin of, once Evidence Communities are on for it.");
    if ((await countOf(ctx, workspaceLibrariesOf(to))) >= MAX_LIBRARIES_PER_WORKSPACE) throw createError("VALIDATION_ERROR", `${await workspaceName(ctx, to)} has the ${MAX_LIBRARIES_PER_WORKSPACE} communities a workspace can have.`);
    // Its ID, address, settings and the people given a role in it are its own; its owners are the workspace's from now on.
    await ctx.db.patch("evidenceLibraries", community._id, { workspaceId: to });
    await ctx.scheduler.runAfter(0, internal.evidenceLibraries.directory.recountPeople, { libraryId: community._id });
    return null;
  }
  if (kind === "extraction") {
    const job = await extractionJobIn(ctx, from, id);
    if (!job) throw createError("NOT_FOUND", "Extraction not found");
    await ctx.db.patch("extractionJobs", job._id, { workspaceId: to });
    return { table: "extractionJobs", id: job._id };
  }
  const thread = await chatIn(ctx, from, id);
  if (!thread) throw createError("NOT_FOUND", "Chat not found");
  await ctx.db.patch("assistantThreads", thread._id, { workspaceId: to });
  return null;
}

/** The rows whose workspace an item's activity follows. */
type Followed = "collections" | "searches" | "screeningJobs" | "extractionJobs" | "authorProfiles";
const followedValidator = v.union(v.literal("collections"), v.literal("searches"), v.literal("screeningJobs"), v.literal("extractionJobs"), v.literal("authorProfiles"));

/** A library paper as saving it again takes it: the paper and its metadata, without whose library it's in. */
const paperOf = (item: Doc<"libraryItems">) =>
  ({ ...Object.fromEntries(Object.keys(libraryPaper.fields).flatMap((key) => (item[key as keyof typeof item] === undefined ? [] : [[key, item[key as keyof typeof item]]]))), paper: item.paperKey }) as Infer<typeof libraryPaper>;

/**
 * Saves a moved collection's papers to the library of the workspace it's in now, a step at a
 * time from the place made at `from`, and points its places at them; the library it left keeps
 * its own. A collection moved on again meanwhile takes the rest to where it is then.
 *
 * The ratings in it go with it. A person's own collection shows their own ratings, and an
 * organization's the ratings its members gave in it: so a paper's rating by the person whose
 * collection it was becomes theirs in the collection, unless they gave one in it before, and
 * their rating in a collection that comes to them becomes their own of the paper, unless
 * they've one. The ratings given in it stay with it, for an organization it moves to later, so
 * one that goes out and comes back has the ratings it left with.
 */
export const moveCollectionPapers = internalMutation({
  args: { collectionId: v.id("collections"), by: v.id("users"), from: v.number() },
  returns: v.null(),
  handler: async (ctx, { collectionId, by, from }) => {
    const collection = await ctx.db.get("collections", collectionId);
    const workspace = collection && (await ctx.db.get("workspaces", collection.workspaceId));
    if (!workspace) return null;
    const members = workspace.kind === "organization" ? (await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active")).take(MAX_ORGANIZATION_MEMBERS)).length : 1;
    const step = Math.min(PAPERS_STEP, Math.max(1, Math.floor(PAPERS_STEP_QUERIES / (4 * members + 13))));
    const left = new Map<Id<"workspaces">, Doc<"workspaces"> | null>();
    const places = await ctx.db.query("libraryItemCollections").withIndex("by_collection", (q) => q.eq("collectionId", collectionId).gte("_creationTime", from)).take(step + 1);
    let read = 0;
    for (const [at, place] of places.entries()) {
      // The next step starts at the place this one stops before. No two of a collection's places are made at the same instant: each is counted in it as it's made.
      if (at > 0 && (at === step || read > PAPERS_STEP_CHARS)) {
        await ctx.scheduler.runAfter(0, internal.workspaces.move.moveCollectionPapers, { collectionId, by, from: place._creationTime });
        break;
      }
      const item = await ctx.db.get("libraryItems", place.libraryItemId);
      if (!item) continue;
      read += JSON.stringify(item).length;
      if (item.workspaceId === workspace._id) continue;
      const saved = (await ctx.db.get("libraryItems", await upsertLibraryItem(ctx, { userId: by, workspaceId: workspace._id }, paperOf(item))))!;
      read += 2 * JSON.stringify(saved).length;
      if (!left.has(item.workspaceId)) left.set(item.workspaceId, await ctx.db.get("workspaces", item.workspaceId));
      const source = left.get(item.workspaceId);
      if (workspace.kind === "organization") {
        // One they gave in it before, in an organization it has been in, stays theirs there.
        if (source?.kind === "personal" && item.rating !== undefined && !(await collectionRatingRow(ctx, source.userId, collectionId, item.paperKey))) await writeRating(ctx, source.userId, collectionId, item.paperKey, item.rating);
      } else if (source?.kind === "organization") {
        const theirs = await collectionRatingRow(ctx, workspace.userId, collectionId, item.paperKey);
        // In a transaction of its own: it brings each of their organizations' copies of the paper in step.
        if (theirs) await ctx.scheduler.runAfter(0, internal.workspaces.move.keepRating, { userId: workspace.userId, paperId: item.paperKey, rating: theirs.rating });
      }
      // Put in here meanwhile: the place it has already stands for both.
      const there = await placeOf(ctx, collectionId, saved._id);
      if (there) await removeCollectionMembership(ctx, place);
      const { rating, count } = await placeRated(ctx, collectionId, saved);
      await ctx.db.patch("libraryItemCollections", (there ?? place)._id, { libraryItemId: saved._id, ...facetsOf(saved, false), rating, ratingCount: count });
    }
    return null;
  },
});

/** Makes a person's rating of a paper in a collection that came to their own workspace their own rating of it, unless they've one. */
export const keepRating = internalMutation({
  args: { userId: v.id("users"), paperId: v.string(), rating: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, paperId, rating }) => {
    if (!(await personalRatingRow(ctx, userId, paperId))) await setPersonalRating(ctx, userId, paperId, rating);
    return null;
  },
});

/**
 * Moves the rows of an item's activity left in `from` to the workspace the item is in now, a
 * step at a time; it stops once the item is back in `from`, so a move and a move back meet.
 */
export const moveActivity = internalMutation({
  args: { from: v.id("workspaces"), item: v.string(), table: followedValidator, id: v.string() },
  returns: v.null(),
  handler: async (ctx, { from, item, table, id }) => {
    const rowId = ctx.db.normalizeId(table, id);
    const now = rowId ? (await ctx.db.get(table, rowId))?.workspaceId : undefined;
    if (!now || now === from) return null;
    const rows = await ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", from).eq("item", item)).take(ACTIVITY_STEP);
    for (const row of rows) await ctx.db.patch("activity", row._id, { workspaceId: now });
    if (rows.length === ACTIVITY_STEP) await ctx.scheduler.runAfter(0, internal.workspaces.move.moveActivity, { from, item, table, id });
    return null;
  },
});

const kindValidator = v.union(...movableKinds.map((kind) => v.literal(kind)));

/** Why an item of the workspace the person is in can't move yet, for its Move dialog; null when it can. */
export const heldAction = defineUserQuery({
  path: "workspaces/move:held",
  description: "Says why an item of the workspace the person is in can't move to another workspace yet, or null when it can.",
  args: { kind: kindValidator, id: v.string() },
  returns: v.union(v.string(), v.null()),
  run: (ctx, actor, { kind, id }) => heldBack(ctx, actor, kind, id),
});
export const held = userQuery(heldAction);
export const heldForAssistant = assistantQuery(heldAction);

export const moveAction = defineUserMutation({
  path: "workspaces/move:move",
  description:
    "Moves an item of the workspace the person is in to another workspace they belong to, and everyone in that workspace then sees it: a collection with its papers, which are saved to that workspace's library while the library it left keeps them; a search (by its ID in the address) with its screening answers, its screenings and its earlier queries; a finished screening of a collection, the library or another screening; a finished extraction job; a chat the person started; an author profile with its publications and editors; or an Evidence Community, which keeps its address, settings and the people given a role in it, and whose owners are that workspace's from then on. " +
    "Only an organization's admins move its work out of it; a running job, or a chat whose reply hasn't finished, moves once it has; a search's screening moves with its search; a collection an Evidence Community follows stays until the community stops following it; a community moves only to a workspace the person may create one in, and once any change running on it has finished. Its activity goes with it. Returns the workspace it went to.",
  args: { kind: kindValidator, id: v.string(), to: v.id("workspaces") },
  returns: v.object({ to: v.id("workspaces") }),
  spendsCredits: false,
  // Everyone in the workspace it goes to sees it from then on.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, actor, { kind, id, to }) => {
    if (to === actor.workspaceId) throw createError("VALIDATION_ERROR", "It's in that workspace already.");
    const person = await ctx.db.get("users", actor.userId);
    if (!person || !(await actorIn(ctx, person, to))) throw createError("NOT_FOUND", "Workspace not found");
    const held = await heldBack(ctx, actor, kind, id);
    if (held) throw createError("VALIDATION_ERROR", held);
    const followed = await rehome(ctx, actor.userId, actor.workspaceId, to, kind, id);
    // Chats and communities keep no activity.
    if (followed && kind !== "chat" && kind !== "community") {
      await ctx.scheduler.runAfter(0, internal.workspaces.move.moveActivity, { from: actor.workspaceId, item: itemKey(kind, id), ...followed });
      await noteActivity(ctx, { workspaceId: to, by: actor.userId, viaAssistant: actor.author === "assistant" }, { kind, id, happened: "moved", detail: await workspaceName(ctx, actor.workspaceId) });
    }
    return { to };
  },
});
export const move = userMutation(moveAction);
export const moveForAssistant = assistantMutation(moveAction);
