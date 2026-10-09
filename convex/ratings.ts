import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workUrl } from "../lib/openalex/work-id";
import { findItem } from "./library/find";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { createError } from "./lib/errors";
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

/** The ID a rating is kept under: a paper's whole OpenAlex address, however it was given, so every rating of it meets. */
export const ratedPaper = (paperId: string) => workUrl(paperId) ?? paperId;

/** A rating, or null for none. */
export const ratingOrNone = v.union(v.number(), v.null());

/** Refuses a rating that isn't a whole number from 0 to 5. */
export function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

/** A person's rating of a paper within a collection, which the collection's people see, or with no collection their own, the same everywhere (#655). */
const ratingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, collectionId: Id<"collections"> | undefined, paperId: string) =>
  ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", collectionId).eq("paperId", ratedPaper(paperId))).unique();
/** A person's own rating of a paper, the same everywhere. */
export const personalRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) => ratingRow(ctx, userId, undefined, paperId);

const rerateRef = makeFunctionReference<"mutation", { workspaceId: Id<"workspaces">; paperId: string; collectionId?: Id<"collections"> }, null>("library/mutations:rerate");

/**
 * Sets a person's own rating of a paper, or clears it with null, and brings the rating of each
 * copy of the paper saved in their workspaces in step with it: their own at once, and each
 * organization's in a transaction of its own, since one reads all its members' ratings.
 */
export async function setPersonalRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null) {
  const row = await personalRatingRow(ctx, userId, paperId);
  if ((row?.rating ?? null) === rating) return;
  if (rating === null) await ctx.db.delete("ratings", row!._id);
  else if (!row) await ctx.db.insert("ratings", { userId, paperId: ratedPaper(paperId), rating });
  else await ctx.db.patch("ratings", row._id, { rating });
  for (const workspace of await ratingWorkspaces(ctx, userId)) {
    if (workspace.kind === "organization") await ctx.scheduler.runAfter(0, rerateRef, { workspaceId: workspace._id, paperId });
    else await rerate(ctx, workspace._id, paperId);
  }
}

/** Brings a workspace's copy of a paper, if it has one, in step with its people's ratings, or with `collectionId` its place in that collection. */
export async function rerate(ctx: MutationCtx, workspaceId: Id<"workspaces">, paperId: string, collectionId?: Id<"collections">) {
  const item = await findItem(ctx, workspaceId, paperId);
  if (!item) return;
  if (!collectionId) return await rateItem(ctx, item);
  const place = await placeOf(ctx, collectionId, item._id);
  if (place) await ratePlace(ctx, place, item);
}

/** The most members of an organization its averages read, and ratings of a paper in one collection; Clerk lets a free organization have 5 members. */
const MAX_RATERS = 1_000;

/** The workspaces whose saved papers a person's ratings count in: their own, and their organizations'. */
async function ratingWorkspaces(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (!user) return [];
  const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", user.clerkId).eq("state", "active")).take(MAX_ORGANIZATIONS_PER_PERSON);
  const organizations = await Promise.all(memberships.map((membership) => ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", membership.organizationId)).unique()));
  return [own, ...organizations].flatMap((workspace) => (workspace ? [workspace] : []));
}

/** The people whose ratings count in an organization's averages: its active members. */
async function raters(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">) {
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).take(MAX_RATERS);
  const users = await Promise.all(memberships.map((membership) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique()));
  return users.flatMap((user) => (user?.state === "active" ? [user._id] : []));
}

const average = (ratings: number[]) => (ratings.length ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length : undefined);

/**
 * A saved paper's rating in a workspace: the average of its people's own ratings of it, or none
 * when none of them rated it. In a person's own workspace that's their rating.
 */
export async function workspaceRating(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paperId: string): Promise<number | undefined> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return undefined;
  if (workspace.kind === "personal") return (await personalRatingRow(ctx, workspace.userId, paperId))?.rating;
  const rows = await Promise.all((await raters(ctx, workspace.organizationId)).map((userId) => personalRatingRow(ctx, userId, paperId)));
  return average(rows.flatMap((row) => (row ? [row.rating] : [])));
}

/** Whether someone is an active member of an organization now. */
async function isMember(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (user?.state !== "active") return false;
  const membership = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organizationId).eq("clerkUserId", user.clerkId).eq("state", "active"))
    .first();
  return membership !== null;
}

/**
 * What a paper sorts and filters by in a collection. In an organization, the collection rates
 * its papers itself: its members' average of their ratings there. Only people who could open
 * the collection rated in it, so its own ratings of the paper are read, not every member's: a
 * place nobody rated costs one read. In a person's own workspace, the paper's rating, which is theirs.
 */
export async function placeRating(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, item: Doc<"libraryItems">) {
  const workspace = await ctx.db.get("workspaces", item.workspaceId);
  if (workspace?.kind !== "organization") return item.rating;
  const rows = await ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collectionId).eq("paperId", ratedPaper(item.openalexId))).take(MAX_RATERS);
  const counted = await Promise.all(rows.map((row) => isMember(ctx, workspace.organizationId, row.userId)));
  return average(rows.flatMap((row, at) => (counted[at] ? [row.rating] : [])));
}

/** Brings a paper's place in a collection in step with the rating it has there. */
async function ratePlace(ctx: MutationCtx, place: Doc<"libraryItemCollections">, item: Doc<"libraryItems">) {
  const rating = await placeRating(ctx, place.collectionId, item);
  if (rating !== place.rating) await ctx.db.patch("libraryItemCollections", place._id, { rating });
}

/** A paper's place in a collection. */
export const placeOf = (ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, libraryItemId: Id<"libraryItems">) =>
  ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collectionId).eq("libraryItemId", libraryItemId)).unique();

/** A person's rating of a paper within an organization's collection, which its members see. */
export const collectionRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, collectionId: Id<"collections">, paperId: string) => ratingRow(ctx, userId, collectionId, paperId);

/** Sets a person's rating of a paper in a collection, or clears it with null, and the collection's average of it. */
export async function setCollectionRating(ctx: MutationCtx, userId: Id<"users">, place: Doc<"libraryItemCollections">, item: Doc<"libraryItems">, rating: number | null) {
  const row = await collectionRatingRow(ctx, userId, place.collectionId, item.openalexId);
  if ((row?.rating ?? null) === rating) return;
  if (rating === null) await ctx.db.delete("ratings", row!._id);
  else if (!row) await ctx.db.insert("ratings", { userId, paperId: ratedPaper(item.openalexId), collectionId: place.collectionId, rating });
  else await ctx.db.patch("ratings", row._id, { rating });
  await ratePlace(ctx, place, item);
}

/** Deletes a step of a deleted collection's ratings. Returns whether all are gone. */
export async function purgeCollectionRatings(ctx: MutationCtx, collectionId: Id<"collections">, step: number) {
  const rows = await ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collectionId)).take(step);
  for (const row of rows) await ctx.db.delete("ratings", row._id);
  return rows.length < step;
}

/** Brings a saved paper's rating in step with its workspace's people's ratings of it. */
export async function rateItem(ctx: MutationCtx, item: Doc<"libraryItems">) {
  const rating = await workspaceRating(ctx, item.workspaceId, item.openalexId);
  if (rating !== item.rating) await ctx.db.patch("libraryItems", item._id, { rating });
}

/** How many of a person's ratings one step re-rates in an organization they joined or left. */
const RERATE_STEP = 100;
const rerateMember = makeFunctionReference<"mutation", { workspaceId: Id<"workspaces">; userId: Id<"users">; cursor: string | null }, null>("library/mutations:rerateMember");

/** Someone who joins or leaves an organization brings their ratings into its averages, or takes them out. */
export async function rerateOnMembership(ctx: MutationCtx, change: Change<DataModel, "organizationMemberships">) {
  if ((change.oldDoc?.state === "active") === (change.newDoc?.state === "active")) return;
  const { organizationId, clerkUserId } = (change.newDoc ?? change.oldDoc)!;
  const workspace = await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId)).unique();
  const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId)).unique();
  if (workspace && user) await ctx.scheduler.runAfter(0, rerateMember, { workspaceId: workspace._id, userId: user._id, cursor: null });
}

/** Re-rates, each in a transaction of its own, a step of the workspace's papers this person rated, and their places in its collections; schedules the next step. */
export async function rerateMemberStep(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, cursor: string | null) {
  const page = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId)).paginate({ cursor, numItems: RERATE_STEP });
  for (const { collectionId, paperId } of page.page) {
    // Their ratings in another workspace's collections don't count here.
    if (collectionId && (await ctx.db.get("collections", collectionId))?.workspaceId !== workspaceId) continue;
    await ctx.scheduler.runAfter(0, rerateRef, { workspaceId, paperId, ...(collectionId ? { collectionId } : {}) });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, rerateMember, { workspaceId, userId, cursor: page.continueCursor });
}

/** How many of a purged person's ratings go per cleanup run. */
const PURGE_RATINGS = 200;

/** Deletes a step of a purged person's ratings, their own and in collections. Returns whether all are gone. */
export async function purgeRatings(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId)).take(PURGE_RATINGS);
  for (const row of rows) await ctx.db.delete("ratings", row._id);
  return rows.length < PURGE_RATINGS;
}
