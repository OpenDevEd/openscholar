import { internalMutation } from "../lib/functions";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { collectionCountRow } from "../library/collections";
import { countRow } from "../research/recordCounts";
import { libraryCountRow } from "../library/counter";

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

        // Delete extraction jobs (cascade to papers, results, evidence units, etc.)
        // Uses existing deleteExtractionInternal which handles all 9 child tables
        const extractionJobs = await ctx.db
          .query("extractionJobs")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(BATCH_SIZE);
        for (const job of extractionJobs) {
          await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.admin.deleteExtractionInternal, {
            jobId: job._id,
          });
        }

        // If we found a full batch of extraction jobs, there may be more.
        // Don't delete the user yet -- re-schedule to handle remaining jobs.
        if (extractionJobs.length === BATCH_SIZE) {
          continue; // Skip user delete, process on next run
        }

        // Delete Zotero connections (personal data, no audit value)
        const zoteroConns = await ctx.db
          .query("zoteroConnections")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();
        for (const conn of zoteroConns) {
          await ctx.db.delete("zoteroConnections", conn._id);
        }

        // billingUsage rows stay as financial records; the snapshot is a cache.
        const account = await ctx.db
          .query("billingAccounts")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .unique();
        if (account) await ctx.db.delete("billingAccounts", account._id);
        // The library count is a cache of the person's saved papers, so it goes with them.
        const libraryCount = await libraryCountRow(ctx, user._id);
        if (libraryCount) await ctx.db.delete("libraryCounts", libraryCount._id);
        const collectionCount = await collectionCountRow(ctx, user._id);
        if (collectionCount) await ctx.db.delete("collectionCounts", collectionCount._id);
        for (const table of ["searches", "queryShortcuts"] as const) {
          const counted = await countRow(ctx, table, user._id);
          if (counted) await ctx.db.delete("recordCounts", counted._id);
        }

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
