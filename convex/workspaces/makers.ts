// Who made something in an organization (#651), as its lists show them beside it. Your own
// workspace's items are all yours, so they name no one.

import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../lib/people";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { byMakerValidator, countRow, makerCountRow, type ByMaker } from "../research/recordCounts";
import { collectionCountRow } from "../library/counter";

export const makerValidator = v.object({ name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean() });
export type Maker = Infer<typeof makerValidator>;

/**
 * Names the maker of each item a page of an organization's list holds, reading each person once;
 * in your own workspace it names no one.
 */
export async function makersIn(ctx: QueryCtx, workspaceId: Id<"workspaces">, viewer: Id<"users">) {
  const organization = (await ctx.db.get("workspaces", workspaceId))?.kind === "organization";
  const read = new Map<Id<"users">, Promise<Maker | undefined>>();
  return (createdBy: Id<"users"> | undefined): Promise<Maker | undefined> => {
    if (!organization || !createdBy) return Promise.resolve(undefined);
    if (!read.has(createdBy)) {
      read.set(createdBy, ctx.db.get("users", createdBy).then((user) => (user ? { name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: user._id === viewer } : undefined)));
    }
    return read.get(createdBy)!;
  };
}

/**
 * An organization's members, a page at a time, each with how many of one kind of record they made
 * there (#656): what a list's Run by filter shows. A person's own workspace is all theirs, so it lists no one.
 */
/** Makers of a table read for those who left: one count row each, for every person who ever made one there. */
const MAKER_ROWS_READ = 1000;

/** People who made some of a table in an organization and aren't its active members any more. */
async function departed(ctx: QueryCtx, table: ByMaker, workspaceId: Id<"workspaces">, organizationId: Id<"organizations">) {
  const makers = await ctx.db.query("recordCounts").withIndex("by_workspace_and_table_and_createdBy", (q) => q.eq("workspaceId", workspaceId).eq("table", table)).take(MAKER_ROWS_READ);
  const people = await Promise.all(makers.map(async ({ createdBy, count }) => {
    if (!createdBy || count === 0) return null;
    const user = await ctx.db.get("users", createdBy);
    if (!user) return null;
    const member = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organizationId).eq("clerkUserId", user.clerkId).eq("state", "active")).first();
    return member ? null : user;
  }));
  return people.filter((user): user is Doc<"users"> => user !== null);
}

export const countsAction = defineUserQuery({
  path: "workspaces/makers:counts",
  description:
    "Lists the members of the organization the person is in, a page at a time, each with how many of one kind of record they made there: searches, screenings, extractions, collections or chats. " +
    "Their `userId` is what lists take as `by` to show only that member's. The person themselves comes first, on the first page; members who have left, with what they made, come last. In the person's own workspace everything is theirs, so it lists no one.",
  args: { table: byMakerValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ userId: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean(), count: v.number() })),
  run: async (ctx, { userId, workspaceId }, { table, paginationOpts }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active"))
      .paginate(paginationOpts);
    const row = async (user: Doc<"users">) => ({ userId: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: user._id === userId, count: (await makerCountRow(ctx, table, workspaceId, user._id))?.count ?? 0 });
    const rows = await Promise.all(page.page.map(async (membership) => {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
      // The person is on the first page wherever their membership falls, and only there.
      return user && user.state === "active" && user._id !== userId ? [await row(user)] : [];
    }));
    const you = paginationOpts.cursor === null ? await ctx.db.get("users", userId) : null;
    // Members who left keep what they made there, so the last page lists those of them who made any.
    const left = page.isDone ? await departed(ctx, table, workspaceId, workspace.organizationId) : [];
    return { ...page, page: [...(you ? [await row(you)] : []), ...rows.flat(), ...(await Promise.all(left.map(row)))] };
  },
});
export const counts = userQuery(countsAction);

/** How many of a table an organization has, whoever made them, those who've left included; none kept for chats. */
async function workspaceTotal(ctx: QueryCtx, table: ByMaker, workspaceId: Id<"workspaces">) {
  if (table === "assistantThreads") return null;
  const counted = table === "collections" ? await collectionCountRow(ctx, workspaceId) : await countRow(ctx, table, workspaceId);
  return counted?.count ?? 0;
}

export const totalAction = defineUserQuery({
  path: "workspaces/makers:total",
  description: "How many of one kind of record the organization has, whoever made them, including members who have left: searches, screenings, extractions or collections. Null for chats, which aren't counted.",
  args: { table: byMakerValidator },
  returns: v.union(v.number(), v.null()),
  run: (ctx, { workspaceId }, { table }) => workspaceTotal(ctx, table, workspaceId),
});
export const total = userQuery(totalAction);
export const totalForAssistant = assistantQuery(totalAction);
export const countsForAssistant = assistantQuery(countsAction);
