import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workUrl } from "../lib/openalex/work-id";
import { findItem } from "./library/find";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";

/** The ID a rating is kept under: a paper's whole OpenAlex address, however it was given, so every rating of it meets. */
export const ratedPaper = (paperId: string) => workUrl(paperId) ?? paperId;

/** A person's own rating of a paper, the same everywhere (#655). */
export const personalRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) =>
  ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", undefined).eq("paperId", ratedPaper(paperId))).unique();

/**
 * Sets a person's own rating of a paper, or clears it with null, and brings the rating of each
 * copy of the paper saved in their workspaces in step with it.
 */
export async function setPersonalRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null) {
  const row = await personalRatingRow(ctx, userId, paperId);
  if ((row?.rating ?? null) === rating) return;
  if (rating === null) await ctx.db.delete("ratings", row!._id);
  else if (!row) await ctx.db.insert("ratings", { userId, paperId: ratedPaper(paperId), rating });
  else await ctx.db.patch("ratings", row._id, { rating });
  for (const workspaceId of await ratingWorkspaces(ctx, userId)) {
    const item = await findItem(ctx, workspaceId, paperId);
    if (item) await rateItem(ctx, item);
  }
}

/** The most raters of one paper an organization's average reads. */
const MAX_RATERS = 1_000;

/** The workspaces whose saved papers a person's ratings count in: their own, and their organizations'. */
async function ratingWorkspaces(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  const user = await ctx.db.get("users", userId);
  if (!user) return [];
  const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", user.clerkId).eq("state", "active")).take(MAX_ORGANIZATIONS_PER_PERSON);
  const organizations = await Promise.all(memberships.map((membership) => ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", membership.organizationId)).unique()));
  return [own, ...organizations].flatMap((workspace) => (workspace ? [workspace._id] : []));
}

/** Whether a person's rating counts in a workspace: theirs, or an organization they're an active member of. */
async function ratesIn(ctx: Pick<QueryCtx, "db">, workspace: Doc<"workspaces">, userId: Id<"users">) {
  if (workspace.kind === "personal") return workspace.userId === userId;
  const user = await ctx.db.get("users", userId);
  if (!user || user.state !== "active") return false;
  const membership = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("clerkUserId", user.clerkId).eq("state", "active"))
    .first();
  return membership !== null;
}

/**
 * A saved paper's rating in a workspace: the average of its people's own ratings of it, or none
 * when none of them rated it. In a person's own workspace that's their rating.
 * ponytail: an organization's average reads every rating of the paper and keeps its members'; keep a running sum on the paper if papers get thousands of raters.
 */
export async function workspaceRating(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paperId: string): Promise<number | undefined> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return undefined;
  if (workspace.kind === "personal") return (await personalRatingRow(ctx, workspace.userId, paperId))?.rating;
  const rows = await ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", undefined).eq("paperId", ratedPaper(paperId))).take(MAX_RATERS);
  const counted: number[] = [];
  for (const row of rows) if (await ratesIn(ctx, workspace, row.userId)) counted.push(row.rating);
  return counted.length ? counted.reduce((total, rating) => total + rating, 0) / counted.length : undefined;
}

/** Brings a saved paper's rating in step with its workspace's people's ratings of it. */
export async function rateItem(ctx: MutationCtx, item: Doc<"libraryItems">) {
  const rating = await workspaceRating(ctx, item.workspaceId, item.openalexId);
  if (rating !== item.rating) await ctx.db.patch("libraryItems", item._id, { rating });
}

/** How many of a purged person's ratings go per cleanup run. */
const PURGE_RATINGS = 200;

/** Deletes a step of a purged person's ratings, their own and in collections. Returns whether all are gone. */
export async function purgeRatings(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId)).take(PURGE_RATINGS);
  for (const row of rows) await ctx.db.delete("ratings", row._id);
  return rows.length < PURGE_RATINGS;
}
