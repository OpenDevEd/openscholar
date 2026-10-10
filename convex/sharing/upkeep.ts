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
import { FOLLOW_STEP, findShared } from "./items";
import { sharedKindValidator } from "./validators";

/**
 * Gives a step of an item's guests its name as it is now, from `cursor` on, or deletes a step
 * of its guests and then of its invitations once it's gone.
 */
export const follow = internalMutation({
  args: { kind: sharedKindValidator, item: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { kind, item, cursor }) => {
    const shared = await findShared(ctx, kind, item);
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
    if (guests.length === FOLLOW_STEP || invitations.length === FOLLOW_STEP) await ctx.scheduler.runAfter(0, internal.sharing.upkeep.follow, { kind, item, cursor: null });
    return null;
  },
});

/** Places as a guest one cleanup run takes from a purged account. */
const PURGE_GRANTS = 200;

/** Deletes a step of a purged account's places as a guest. Returns whether all are gone. */
export async function purgeGrants(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("itemAccess").withIndex("by_user_and_grantedAt", (q) => q.eq("userId", userId)).take(PURGE_GRANTS);
  for (const row of rows) await ctx.db.delete("itemAccess", row._id);
  return rows.length < PURGE_GRANTS;
}
