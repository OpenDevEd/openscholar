import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Deprecated pre-launch cleanup endpoint.
 * Duplicate-subscription remediation is no longer part of runtime billing flow.
 */
export const cleanupDuplicateSubscriptions = mutation({
  args: {},
  returns: v.object({
    cleaned: v.number(),
    keptPlan: v.optional(v.string()),
  }),
  handler: async () => {
    return { cleaned: 0 };
  },
});

/**
 * Deprecated internal cleanup endpoint.
 */
export const cleanupDuplicateSubscriptionsInternal = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    cleaned: v.number(),
    keptPlan: v.optional(v.string()),
    totalSubscriptions: v.number(),
  }),
  handler: async () => {
    return { cleaned: 0, totalSubscriptions: 0 };
  },
});

/**
 * Deprecated no-op kept only for compatibility with older callers.
 */
export const linkStripeCustomer = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    stripeCustomerId: v.string(),
  },
  returns: v.null(),
  handler: async () => {
    return null;
  },
});
