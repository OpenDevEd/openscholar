/**
 * Keeping guest rows true to their item (#653), a step at a time: its name as it changes,
 * and nothing left of an item that's gone. The triggers start it (./items.ts
 * `followShared`), and an account's cleanup takes its places as a guest.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { FOLLOW_STEP, findShared, hasGuests } from "./items";
import { sharedKindValidator, sharedKinds } from "./validators";

/**
 * Gives a step of an item's guests its name as it is now, from `cursor` on, or deletes a step
 * of its guests and then of its invitations once it's gone.
 */
export const follow = internalMutation({
  args: { kind: sharedKindValidator, item: v.string(), cursor: v.union(v.string(), v.null()), closed: v.optional(v.literal(true)) },
  returns: v.null(),
  handler: async (ctx, { kind, item, cursor, closed }) => {
    // One closed with its workspace (`close`) is gone to its guests, though its row waits out its retention.
    const shared = closed ? null : await findShared(ctx, kind, item);
    if (shared) {
      const guests = await ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", item)).paginate({ cursor, numItems: FOLLOW_STEP });
      for (const row of guests.page) if (row.name !== shared.name) await ctx.db.patch("itemAccess", row._id, { name: shared.name });
      if (!guests.isDone) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.follow, { kind, item, cursor: guests.continueCursor });
      return null;
    }
    const guests = await ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", item)).take(FOLLOW_STEP);
    for (const row of guests) await ctx.db.delete("itemAccess", row._id);
    const invitations = guests.length < FOLLOW_STEP ? await ctx.db.query("itemInvitations").withIndex("by_item_and_state", (q) => q.eq("item", item)).take(FOLLOW_STEP) : [];
    for (const row of invitations) await ctx.db.delete("itemInvitations", row._id);
    if (guests.length === FOLLOW_STEP || invitations.length === FOLLOW_STEP) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.follow, { kind, item, cursor: null, ...(closed ? { closed } : {}) });
    return null;
  },
});

/** Items one step of `close` looks through for ones with guests. */
const CLOSE_STEP = 50;

/**
 * Ends every guest's place in a workspace's items, a page of one kind's items at a time, kind
 * after kind. A deleted account's workspace waits out its retention before it's purged, and
 * nobody should read it meanwhile. Each kind that's shared lists its items here.
 */
export const close = internalMutation({
  args: { workspaceId: v.id("workspaces"), cursor: v.union(v.string(), v.null()), kind: v.optional(sharedKindValidator) },
  returns: v.null(),
  handler: async (ctx, { workspaceId, cursor, kind = sharedKinds[0] }) => {
    const page = { cursor, numItems: CLOSE_STEP };
    const items =
      kind === "collection"
        ? await ctx.db.query("collections").withIndex("by_workspace_sortName", (q) => q.eq("workspaceId", workspaceId)).paginate(page)
        : kind === "screening"
          ? await ctx.db.query("screeningJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).paginate(page)
          : kind === "extraction"
            ? await ctx.db.query("extractionJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).paginate(page)
            : kind === "search"
              ? // A search holds its whole query: a page of them stops at these bytes and goes on from its cursor.
                await ctx.db.query("searches").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).paginate({ ...page, maximumBytesRead: 4 * 1024 * 1024 })
              : await ctx.db.query("authorProfiles").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).paginate(page);
    for (const item of items.page) {
      if (await hasGuests(ctx, item._id)) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.follow, { kind, item: item._id, cursor: null, closed: true });
    }
    const next = items.isDone ? sharedKinds[sharedKinds.indexOf(kind) + 1] : kind;
    if (next) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.close, { workspaceId, cursor: items.isDone ? null : items.continueCursor, kind: next });
    return null;
  },
});

/** Places as a guest one step takes from a purged account: each deletion also takes the row out of three counts. */
const PURGE_GRANTS = 25;

/** Takes a step of a purged account's places as a guest, and schedules the next while any are left. */
export const purge = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db.query("itemAccess").withIndex("by_user_and_grantedAt", (q) => q.eq("userId", userId)).take(PURGE_GRANTS);
    for (const row of rows) await ctx.db.delete("itemAccess", row._id);
    if (rows.length === PURGE_GRANTS) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.purge, { userId });
    return null;
  },
});

/**
 * Whether a purged account has no places as a guest left. While it has, they go in transactions
 * of their own, apart from the cleanup run that asks, which takes many accounts at once.
 */
export async function purgeGrants(ctx: MutationCtx, userId: Id<"users">) {
  const left = await ctx.db.query("itemAccess").withIndex("by_user_and_grantedAt", (q) => q.eq("userId", userId)).first();
  if (left) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.purge, { userId });
  return !left;
}
