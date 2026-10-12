/**
 * Each account's addresses Clerk has verified (../lib/people.ts `addressesOf`), read for every account at once: the
 * Clerk webhook keeps them from each account's next change on, and this fills them for accounts made before it did, or
 * after events it missed. Run it with `npx convex run users/verifiedEmails:refresh`.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../lib/functions";
import { clerkRequest, clerkSecretKey } from "../lib/clerk";
import { MAX_VERIFIED_EMAILS } from "../lib/listCaps";
import { CLERK_USERS_PAGE, verifiedEmailsPageValidator } from "../lib/validators";
import { parseClerkUserPayload } from "../webhooks/clerk";
import { mapClerkUserToUpsertArgs } from "../webhooks/clerk_mappers";

export const refresh = internalAction({
  args: { offset: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { offset = 0 }) => {
    // Oldest first, so an account made while this runs comes at the end and moves none before it.
    const { body } = await clerkRequest(clerkSecretKey(), "GET", `/users?limit=${CLERK_USERS_PAGE}&offset=${offset}&order_by=%2Bcreated_at`);
    const rows = Array.isArray(body) ? body : [];
    const users = rows.flatMap((row) => {
      const user = parseClerkUserPayload(row);
      return user ? [mapClerkUserToUpsertArgs(user)] : [];
    });
    await ctx.runMutation(internal.users.verifiedEmails.keep, { users: users.map(({ clerkId, verifiedEmails }) => ({ clerkId, verifiedEmails: [...new Set(verifiedEmails)].slice(0, MAX_VERIFIED_EMAILS) })) });
    if (rows.length === CLERK_USERS_PAGE) await ctx.scheduler.runAfter(0, internal.users.verifiedEmails.refresh, { offset: offset + CLERK_USERS_PAGE });
    return null;
  },
});

export const keep = internalMutation({
  args: { users: verifiedEmailsPageValidator },
  returns: v.null(),
  handler: async (ctx, { users }) => {
    for (const { clerkId, verifiedEmails } of users) {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique();
      if (user) await ctx.db.patch("users", user._id, { verifiedEmails });
    }
    return null;
  },
});
