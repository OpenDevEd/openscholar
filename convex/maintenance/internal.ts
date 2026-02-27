import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

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
    const BATCH_SIZE = 50;

    // Find deleted users past retention period
    const deletedUsers = await ctx.db
      .query("users")
      .withIndex("by_state", (q) => q.eq("state", "deleted"))
      .take(BATCH_SIZE);

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

        // Hard delete the user to prevent re-processing
        await ctx.db.delete(user._id);

        // Note: We keep credits and subscriptions for audit purposes

        cleanedCount++;
      }
    }

    // If we fetched a full batch, there might be more to process
    if (deletedUsers.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.maintenance.internal.cleanupDeletedUsers, {});
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} deleted users`);
    }
  },
});

/**
 * Check subscription statuses and handle past-due subscriptions.
 * Auto-downgrades subscriptions past the 7-day grace period to free plan.
 */
export const checkSubscriptionStatus = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per locked decision

    // Find past_due subscriptions
    const pastDueSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();

    let downgradeCount = 0;

    for (const sub of pastDueSubs) {
      const pastDueSince = sub.pastDueSince ?? sub.updatedAt;
      if (now - pastDueSince > GRACE_PERIOD_MS) {
        // Grace period expired -- downgrade to free plan
        // Per locked decision: automatically downgrade to free plan after grace period
        await ctx.db.patch(sub._id, {
          status: "canceled",
          plan: "free",
          canceledAt: now,
          updatedAt: now,
          creditsPerMonth: 0,
          pastDueSince: undefined,
          // stripeSubscriptionId preserved for audit trail (consistent with SUB-03 fix)
        });
        downgradeCount++;
        console.warn(`[checkSubscriptionStatus] Grace period expired, downgraded subscription ${sub._id} to free`, {
          userId: sub.userId,
          pastDueSince,
          gracePeriodDays: 7,
        });
      }
    }

    // Also check for active subscriptions past their period end (existing behavior, kept)
    const activeSubscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    for (const sub of activeSubscriptions) {
      if (sub.currentPeriodEnd && sub.currentPeriodEnd < now) {
        console.warn(`[checkSubscriptionStatus] Subscription ${sub._id} past period end, needs attention`);
      }
    }

    if (downgradeCount > 0) {
      console.log(`[checkSubscriptionStatus] Downgraded ${downgradeCount} past-due subscriptions after grace period`);
    }

    return null;
  },
});
