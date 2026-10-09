import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workUrl } from "../lib/openalex/work-id";
import { findItem } from "./library/find";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { createError } from "./lib/errors";
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";

/** The ID a rating is kept under: a paper's whole OpenAlex address, however it was given, so every rating of it meets. */
export const ratedPaper = (paperId: string) => workUrl(paperId) ?? paperId;

/** Refuses a rating that isn't a whole number from 0 to 5. */
export function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

/** A person's own rating of a paper, the same everywhere (#655). */
export const personalRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) =>
  ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", undefined).eq("paperId", ratedPaper(paperId))).unique();

const rerateRef = makeFunctionReference<"mutation", { workspaceId: Id<"workspaces">; paperId: string }, null>("library/mutations:rerate");

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

/** Brings a workspace's copy of a paper, if it has one, in step with its people's ratings. */
export async function rerate(ctx: MutationCtx, workspaceId: Id<"workspaces">, paperId: string) {
  const item = await findItem(ctx, workspaceId, paperId);
  if (item) await rateItem(ctx, item);
}

/** The most members of an organization its averages read; Clerk lets a free organization have 5. */
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

/**
 * A saved paper's rating in a workspace: the average of its people's own ratings of it, or none
 * when none of them rated it. In a person's own workspace that's their rating.
 */
export async function workspaceRating(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paperId: string): Promise<number | undefined> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return undefined;
  if (workspace.kind === "personal") return (await personalRatingRow(ctx, workspace.userId, paperId))?.rating;
  const rows = await Promise.all((await raters(ctx, workspace.organizationId)).map((userId) => personalRatingRow(ctx, userId, paperId)));
  const counted = rows.flatMap((row) => (row ? [row.rating] : []));
  return counted.length ? counted.reduce((total, rating) => total + rating, 0) / counted.length : undefined;
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

/** Re-rates, each in a transaction of its own, a step of the workspace's papers this person rated; schedules the next step. */
export async function rerateMemberStep(ctx: MutationCtx, workspaceId: Id<"workspaces">, userId: Id<"users">, cursor: string | null) {
  const page = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", undefined)).paginate({ cursor, numItems: RERATE_STEP });
  for (const row of page.page) await ctx.scheduler.runAfter(0, rerateRef, { workspaceId, paperId: row.paperId });
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
