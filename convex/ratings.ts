import type { DataModel, Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { paperIdOf, paperKeyOf, toPaperKey } from "../lib/papers/paper-ref";
import { findItem } from "./library/find";
import { MAX_ORGANIZATIONS_PER_PERSON } from "./lib/queryBounds";
import { MAX_RATERS_KEPT } from "./lib/listCaps";
import { createError } from "./lib/errors";
import type { Change } from "convex-helpers/server/triggers";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { personName } from "./lib/people";

/** The ID a rating is kept under: the paper's key (lib/papers/paper-ref.ts), however the paper was named, so every rating of it meets. */
export const ratedPaper = (paperId: string) => toPaperKey(paperId) ?? paperId;

/** A rating, or null for none. */
export const ratingOrNone = v.union(v.number(), v.null());

/** Refuses a rating that isn't a whole number from 0 to 5. */
export function requireRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
    throw createError("VALIDATION_ERROR", "Rating must be an integer from 0 to 5.");
  }
}

/** A person's rating of a paper within a collection, which the collection's people see, or with no collection their own, the same everywhere (#655). */
async function ratingRow(ctx: Pick<QueryCtx, "db">, userId: Id<"users">, collectionId: Id<"collections"> | undefined, paperId: string) {
  const key = ratedPaper(paperId);
  const under = (id: string) => ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", collectionId).eq("paperId", id)).unique();
  // ponytail: a rating of an OpenAlex paper kept before keys is under its address until migrations/paperIdentity moves it; goes when the old IDs do.
  return (await under(key)) ?? (key.startsWith("openalex:") ? await under(paperIdOf(key)) : null);
}
/** A person's own rating of a paper, the same everywhere. */
export const personalRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) => ratingRow(ctx, userId, undefined, paperId);

/**
 * Writes a person's rating of a paper, in a collection or with none their own, or clears it
 * with null, and returns whether that changed it. What shows the rating is the caller's to bring
 * in step.
 */
export async function writeRating(ctx: MutationCtx, userId: Id<"users">, collectionId: Id<"collections"> | undefined, paperId: string, rating: number | null) {
  const row = await ratingRow(ctx, userId, collectionId, paperId);
  if ((row?.rating ?? null) === rating) return false;
  if (rating === null) await ctx.db.delete("ratings", row!._id);
  else if (!row) await ctx.db.insert("ratings", { userId, paperId: ratedPaper(paperId), ...(collectionId ? { collectionId } : {}), rating });
  else await ctx.db.patch("ratings", row._id, { rating, paperId: ratedPaper(paperId) });
  return true;
}

const rerateRef = makeFunctionReference<"mutation", { workspaceId: Id<"workspaces">; paperId: string; collectionId?: Id<"collections"> }, null>("library/mutations:rerate");

/**
 * Sets a person's own rating of a paper, or clears it with null, and brings the rating of each
 * copy of the paper saved in their workspaces in step with it: their own at once, and each
 * organization's in a transaction of its own, since one reads all its members' ratings.
 */
export async function setPersonalRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null) {
  if (!(await writeRating(ctx, userId, undefined, paperId, rating))) return;
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
async function members(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">) {
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organizationId).eq("state", "active")).take(MAX_RATERS);
  const users = await Promise.all(memberships.map((membership) => ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique()));
  return users.flatMap((user) => (user?.state === "active" ? [user] : []));
}

const average = (ratings: number[]) => (ratings.length ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length : undefined);

/** A member's own rating of a paper, as a saved paper keeps the first of them: the rating row, whose it is, and what they gave. */
type Given = { id: Id<"ratings">; userId: Id<"users">; rating: number };

/**
 * How a workspace's people rated a saved paper themselves: the average of their own ratings of it,
 * or none when none of them rated it. In a person's own workspace that's their rating. In an
 * organization's, also how many members gave one and the first of them (#801), which its library
 * lists beside the average.
 */
export async function workspaceRated(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paperId: string): Promise<{ rating?: number; count?: number; by?: Given[] }> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  if (!workspace) return {};
  if (workspace.kind === "personal") {
    const rating = (await personalRatingRow(ctx, workspace.userId, paperId))?.rating;
    return rating === undefined ? {} : { rating };
  }
  const rows = await Promise.all((await members(ctx, workspace.organizationId)).map((user) => personalRatingRow(ctx, user._id, paperId)));
  const given = rows.flatMap((row) => (row ? [{ id: row._id, userId: row.userId, rating: row.rating }] : []));
  return given.length ? { rating: average(given.map((one) => one.rating)), count: given.length, by: given.slice(0, MAX_RATERS_KEPT) } : {};
}

/** A saved paper's rating in a workspace (`workspaceRated`). */
export const workspaceRating = async (ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">, paperId: string) => (await workspaceRated(ctx, workspaceId, paperId)).rating;

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

/** Someone's rating of a paper in an organization's collection, with who they are; `id` is the rating's. */
export type Rater = { id: Id<"ratings">; userId: Id<"users">; name: string; imageUrl?: string; you: boolean; rating: number };
/** A rater as the people reading see them. */
export const raterValidator = v.object({ id: v.id("ratings"), name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean(), rating: v.number() });
export const shownRater = ({ userId: _userId, ...rater }: Rater) => rater;
const raterOf = (given: Given, user: Doc<"users">, viewer: Id<"users">): Rater => ({ ...given, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: user._id === viewer });

/**
 * Up to `max` of the ratings a paper has in an organization's collection from its members now,
 * each with who gave it, the person reading first (#655). Former members' ratings are passed
 * over, so the ratings are read until `max` members' are found. None in a person's own
 * workspace, whose collections have no ratings of their own.
 */
export async function collectionRaters(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, paperId: string, viewer: Id<"users">, max: number): Promise<Rater[]> {
  const organizationId = await organizationOfCollection(ctx, collectionId);
  if (!organizationId) return [];
  const mine = await collectionRatingRow(ctx, viewer, collectionId, paperId);
  const raters = mine ? await asRaters(ctx, organizationId, [mine], viewer) : [];
  for (const row of await collectionRatingsOf(ctx, collectionId, paperId).take(PREVIEW_READ)) {
    if (raters.length >= max) break;
    if (row.userId !== viewer) raters.push(...(await asRaters(ctx, organizationId, [row], viewer)));
  }
  return raters;
}

/** Ratings of a paper a preview of its raters reads at most, past former members' to the members' it names. */
const PREVIEW_READ = 50;

/**
 * The members a saved paper keeps as having rated it, as the organization's library lists them
 * (#801): the person reading first, by their own rating row `mine`, then the others it keeps.
 * `person` reads someone once however many papers ask.
 */
export async function keptRaters(item: Doc<"libraryItems">, viewer: Id<"users">, mine: Doc<"ratings"> | null, person: (userId: Id<"users">) => Promise<Doc<"users"> | null>): Promise<Rater[]> {
  const own = mine ? [{ id: mine._id, userId: viewer, rating: mine.rating }] : [];
  const given = [...own, ...(item.ratedBy ?? []).filter((one) => one.userId !== viewer)].slice(0, MAX_RATERS_KEPT);
  const people = await Promise.all(given.map((one) => person(one.userId)));
  // Someone whose account was deleted since the paper was last rated is passed over: their row stays a while, and they're nobody's to name.
  return given.flatMap((one, at) => (people[at]?.state === "active" ? [raterOf(one, people[at], viewer)] : []));
}

/**
 * Every member's own rating of a paper, as an organization's library lists them in full (#801),
 * the person reading first. Its members are read, not everyone who rated the paper, so other
 * people's ratings of it cost nothing however many there are.
 */
export async function everyRater(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, paperId: string, viewer: Id<"users">): Promise<Rater[]> {
  const people = await members(ctx, organizationId);
  const rows = await Promise.all(people.map((user) => personalRatingRow(ctx, user._id, paperId)));
  const rated = people.flatMap((user, at) => (rows[at] ? [raterOf({ id: rows[at]._id, userId: user._id, rating: rows[at].rating }, user, viewer)] : []));
  return [...rated.filter((rater) => rater.you), ...rated.filter((rater) => !rater.you)];
}

/** A paper's ratings in a collection, a query to read them from. */
export const collectionRatingsOf = (ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, paperId: string) =>
  ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collectionId).eq("paperId", ratedPaper(paperId)));

/** The organization a collection is in, or null for one in a person's own workspace. */
export async function organizationOfCollection(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">) {
  const collection = await ctx.db.get("collections", collectionId);
  const workspace = collection ? await ctx.db.get("workspaces", collection.workspaceId) : null;
  return workspace?.kind === "organization" ? workspace.organizationId : null;
}

/** Ratings with who gave them, those of the organization's members now. */
export async function asRaters(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, rows: Doc<"ratings">[], viewer: Id<"users">): Promise<Rater[]> {
  const people = await Promise.all(rows.map(async (row) => ((await isMember(ctx, organizationId, row.userId)) ? { row, user: (await ctx.db.get("users", row.userId))! } : null)));
  return people.flatMap((person) => (person ? [raterOf({ id: person.row._id, userId: person.user._id, rating: person.row.rating }, person.user, viewer)] : []));
}

/**
 * What a paper sorts and filters by in a collection, and how many rated it there. In an
 * organization, the collection rates its papers itself: its members' average of their ratings
 * there. Only people who could open the collection rated in it, so its own ratings of the paper
 * are read, not every member's: a place nobody rated costs one read. In a person's own
 * workspace, the paper's rating, which is theirs, and no count.
 */
export async function placeRated(ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, item: Doc<"libraryItems">): Promise<{ rating?: number; count?: number }> {
  const workspace = await ctx.db.get("workspaces", item.workspaceId);
  if (workspace?.kind !== "organization") return item.rating === undefined ? {} : { rating: item.rating };
  const key = paperKeyOf(item);
  const under = (id: string) => ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collectionId).eq("paperId", id)).take(MAX_RATERS);
  const keyed = await under(key);
  // ponytail: ratings kept before keys are under the paper's address until migrations/paperIdentity moves them; a person's rating under the key is theirs now. Goes when the old IDs do.
  const older = paperIdOf(key) === key ? [] : (await under(paperIdOf(key))).filter((row) => !keyed.some((rated) => rated.userId === row.userId));
  const rows = [...keyed, ...older];
  const counted = await Promise.all(rows.map((row) => isMember(ctx, workspace.organizationId, row.userId)));
  const given = rows.flatMap((row, at) => (counted[at] ? [row.rating] : []));
  return given.length ? { rating: average(given), count: given.length } : {};
}

/** What a paper sorts and filters by in a collection (`placeRated`). */
export const placeRating = async (ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, item: Doc<"libraryItems">) => (await placeRated(ctx, collectionId, item)).rating;

/** Brings a paper's place in a collection in step with the rating it has there and how many gave it. */
async function ratePlace(ctx: MutationCtx, place: Doc<"libraryItemCollections">, item: Doc<"libraryItems">) {
  const { rating, count } = await placeRated(ctx, place.collectionId, item);
  if (rating !== place.rating || count !== place.ratingCount) await ctx.db.patch("libraryItemCollections", place._id, { rating, ratingCount: count });
}

/** A paper's place in a collection. */
export const placeOf = (ctx: Pick<QueryCtx, "db">, collectionId: Id<"collections">, libraryItemId: Id<"libraryItems">) =>
  ctx.db.query("libraryItemCollections").withIndex("by_collection_item", (q) => q.eq("collectionId", collectionId).eq("libraryItemId", libraryItemId)).unique();

/** A person's rating of a paper within an organization's collection, which its members see. */
export const collectionRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, collectionId: Id<"collections">, paperId: string) => ratingRow(ctx, userId, collectionId, paperId);

/** Sets a person's rating of a paper in a collection, or clears it with null, and the collection's average of it. */
export async function setCollectionRating(ctx: MutationCtx, userId: Id<"users">, place: Doc<"libraryItemCollections">, item: Doc<"libraryItems">, rating: number | null) {
  if (await writeRating(ctx, userId, place.collectionId, paperKeyOf(item), rating)) await ratePlace(ctx, place, item);
}

/** Deletes a step of a deleted collection's ratings. Returns whether all are gone. */
export async function purgeCollectionRatings(ctx: MutationCtx, collectionId: Id<"collections">, step: number) {
  const rows = await ctx.db.query("ratings").withIndex("by_collection_and_paper", (q) => q.eq("collectionId", collectionId)).take(step);
  for (const row of rows) await ctx.db.delete("ratings", row._id);
  return rows.length < step;
}

/** Brings a saved paper's rating in step with its workspace's people's ratings of it, and in an organization who gave it. */
export async function rateItem(ctx: MutationCtx, item: Doc<"libraryItems">) {
  const { rating, count, by } = await workspaceRated(ctx, item.workspaceId, paperKeyOf(item));
  const same = rating === item.rating && count === item.ratingCount && JSON.stringify(by ?? null) === JSON.stringify(item.ratedBy ?? null);
  if (!same) await ctx.db.patch("libraryItems", item._id, { rating, ratingCount: count, ratedBy: by });
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
