// Who made something in an organization (#651), as its lists show them beside it. Your own
// workspace's items are all yours, so they name no one.

import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../lib/people";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { byMakerValidator, makerCountRow } from "../research/recordCounts";

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
export const countsAction = defineUserQuery({
  path: "workspaces/makers:counts",
  description:
    "Lists the members of the organization the person is in, a page at a time, each with how many of one kind of record they made there: searches, screenings, extractions, collections or chats. " +
    "Their `userId` is what lists take as `by` to show only that member's. In the person's own workspace everything is theirs, so it lists no one.",
  args: { table: byMakerValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ userId: v.id("users"), name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean(), count: v.number() })),
  run: async (ctx, { userId, workspaceId }, { table, paginationOpts }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", workspace.organizationId).eq("state", "active"))
      .paginate(paginationOpts);
    const rows = await Promise.all(page.page.map(async (membership) => {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
      if (!user || user.state !== "active") return [];
      const counted = await makerCountRow(ctx, table, workspaceId, user._id);
      return [{ userId: user._id, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: user._id === userId, count: counted?.count ?? 0 }];
    }));
    return { ...page, page: rows.flat() };
  },
});
export const counts = userQuery(countsAction);
export const countsForAssistant = assistantQuery(countsAction);
