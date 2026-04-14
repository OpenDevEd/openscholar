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
          await ctx.db.delete("apiKeys", key._id);
        }

        // Delete Zotero connections (personal data, no audit value)
        const zoteroConns = await ctx.db
          .query("zoteroConnections")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();
        for (const conn of zoteroConns) {
          await ctx.db.delete("zoteroConnections", conn._id);
        }

        // NOTE: Deliberately preserving these tables for financial audit:
        // - creditTransactions (financial records)
        // - credits (balance records)
        // - subscriptions (billing history)

        // Hard delete the user to prevent re-processing
        await ctx.db.delete("users", user._id);

        cleanedCount++;
      }
    }

    // If we fetched a full batch, there might be more to process
    if (deletedUsers.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.maintenance.mutations.cleanupDeletedUsers, {});
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} deleted users`);
    }
  },
});

/**
 * Expire past-due subscriptions that have exceeded the 7-day grace period.
 * Auto-downgrades to free plan with canceled status.
 *
 * Extracted from checkSubscriptionStatus so the past-due logic runs as a
 * mutation (OCC-safe DB writes) while the corrective sync runs as an action
 * (needs Stripe API).
 */
export const expirePastDueSubscriptions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per locked decision

    // Find past_due subscriptions (capped to prevent transaction limit violations)
    const pastDueSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status_updatedAt", (q) => q.eq("status", "past_due"))
      .take(200);

    let downgradeCount = 0;

    for (const sub of pastDueSubs) {
      const pastDueSince = sub.pastDueSince ?? sub.updatedAt;
      if (now - pastDueSince > GRACE_PERIOD_MS) {
        // Grace period expired -- downgrade to free plan
        // Per locked decision: automatically downgrade to free plan after grace period
        await ctx.db.patch("subscriptions", sub._id, {
          status: "canceled",
          plan: "free",
          canceledAt: now,
          updatedAt: now,
          creditsPerMonth: 0,
          pastDueSince: undefined,
          // stripeSubscriptionId preserved for audit trail (consistent with SUB-03 fix)
        });
        downgradeCount++;
        console.warn(`[expirePastDueSubscriptions] Grace period expired, downgraded subscription ${sub._id} to free`, {
          userId: sub.userId,
          pastDueSince,
          gracePeriodDays: 7,
        });
      }
    }

    if (downgradeCount > 0) {
      console.log(`[expirePastDueSubscriptions] Downgraded ${downgradeCount} past-due subscriptions after grace period`);
    }

    return null;
  },
});

/**
 * Monitor for stale failed Stripe events.
 * Flags events that have been in "failed" status for >1 hour via console.error
 * for visibility in the Convex dashboard.
 *
 * Per locked decision: flag only, do NOT auto-retry failed events.
 * Manual investigation is safer for events that failed for a reason.
 */
export const monitorFailedStripeEvents = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Query using by_status_next_retry index (prefix query on status field)
    // Capped to prevent transaction limit violations
    const failedEvents = await ctx.db
      .query("stripeEventLogs")
      .withIndex("by_status_next_retry", (q) => q.eq("status", "failed"))
      .take(200);

    // Filter in JS for updatedAt threshold (no composite index on status+updatedAt)
    const staleFailures = failedEvents.filter((e) => e.updatedAt < oneHourAgo);

    for (const event of staleFailures) {
      console.error(`[ALERT] Stale failed Stripe event`, {
        stripeEventId: event.stripeEventId,
        eventType: event.eventType,
        lastError: event.lastError,
        failedAt: event.updatedAt,
        ageMinutes: Math.floor((Date.now() - event.updatedAt) / 60_000),
      });
    }

    if (staleFailures.length > 0) {
      console.error(
        `[ALERT] ${staleFailures.length} Stripe event(s) in failed status for >1 hour. Manual investigation required.`,
      );
    }

    return null;
  },
});
