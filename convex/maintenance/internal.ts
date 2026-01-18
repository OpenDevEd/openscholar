import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

// Retention period for deleted users (30 days)
const DELETED_USER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Clean up data for users deleted more than 30 days ago
 */
export const cleanupDeletedUsers = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - DELETED_USER_RETENTION_MS;

    // Find deleted users past retention period
    const deletedUsers = await ctx.db
      .query("users")
      .withIndex("by_state", (q) => q.eq("state", "deleted"))
      .collect();

    let cleanedCount = 0;

    for (const user of deletedUsers) {
      if (user.updatedAt < cutoff) {
        // Clean up user's API keys
        const apiKeys = await ctx.db
          .query("apiKeys")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        for (const key of apiKeys) {
          await ctx.db.delete(key._id);
        }

        // Clean up user's memberships
        const memberships = await ctx.db
          .query("memberships")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        for (const membership of memberships) {
          await ctx.db.delete(membership._id);
        }

        // Note: We keep credits, subscriptions, and usage logs for audit purposes
        // but you could clean those up too if needed

        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} deleted users`);
    }
  },
});

/**
 * Aggregate usage statistics for reporting
 */
export const aggregateUsage = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Placeholder for usage aggregation logic
    // You would aggregate usageLogs into summary tables here
    console.log("Usage aggregation completed");
  },
});

/**
 * Check for and handle expired credits
 */
export const checkCreditExpiry = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Placeholder for credit expiry logic
    // If you have expiring credits, handle them here
    console.log("Credit expiry check completed");
  },
});

/**
 * Check subscription statuses and handle past-due subscriptions
 */
export const checkSubscriptionStatus = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    // Find subscriptions that are past their period end
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    for (const sub of subscriptions) {
      if (sub.currentPeriodEnd && sub.currentPeriodEnd < now) {
        // Subscription period has ended without renewal
        // This typically means Stripe webhook was missed
        console.warn(`Subscription ${sub._id} past period end, needs attention`);
      }
    }

    console.log("Subscription status check completed");
  },
});
