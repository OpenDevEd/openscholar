/** Brings a person's organization memberships' search text up to date with their user (./searchText.ts), a page at a time. */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "./functions";
import { memberText } from "./searchText";

/** Memberships one page brings up to date. */
const PAGE = 100;

export const refresh = internalMutation({
  args: { clerkUserId: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { clerkUserId, cursor }) => {
    const page = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", clerkUserId)).paginate({ cursor, numItems: PAGE });
    for (const membership of page.page) {
      const text = await memberText(ctx, membership);
      if (membership.searchText !== text) await ctx.db.patch("organizationMemberships", membership._id, { searchText: text });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.lib.memberText.refresh, { clerkUserId, cursor: page.continueCursor });
    return null;
  },
});
