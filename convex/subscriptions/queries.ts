import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { getPlanTier } from "../lib/constants";
import { subscriptionValidator } from "../lib/validators";
import { selectCanonicalSubscription } from "./lib/selectCanonicalSubscription";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";

export const getMy = query({
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

export const getTier = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    const subscription = selectCanonicalSubscription(subscriptions);

    return getPlanTier(resolveEffectivePlan(subscription));
  },
});
