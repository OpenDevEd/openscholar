import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { userValidator, subscriptionValidator, creditsValidator } from "../lib/validators";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";

export const me = query({
  args: {},
  returns: v.union(userValidator, v.null()),
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

export const getById = query({
  args: { userId: v.id("users") },
  returns: v.union(userValidator, v.null()),
  handler: async (ctx, { userId }) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser) return null;

    if (currentUser._id !== userId) {
      return null;
    }

    return currentUser;
  },
});

export const getMySubscription = query({
  args: {},
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return selectCanonicalSubscription(subscriptions);
  },
});

export const getMyCredits = query({
  args: {},
  returns: v.union(creditsValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
  },
});
