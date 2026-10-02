import { v } from "convex/values";
import { mutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { spendOpenAlexRequests } from "../lib/rateLimit";

/**
 * Counts OpenAlex requests a server action is about to make for the signed-in account.
 * False when the account's minute or day is spent; the action then answers with the
 * limit instead of asking OpenAlex.
 */
export const spend = mutation({
  args: { count: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { count }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw createError("UNAUTHENTICATED", "Sign in to search");
    if (!Number.isInteger(count) || count < 1 || count > 1_000) throw createError("VALIDATION_ERROR", "Count whole requests, from 1 to 1,000");
    return await spendOpenAlexRequests(ctx, identity.subject, count);
  },
});
