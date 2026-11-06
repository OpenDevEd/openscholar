import { MAX_API_KEYS_PER_USER } from "../lib/validators";
import { SINGLE_ROW_CLEANUP } from "../lib/queryBounds";
import { internalMutation } from "../lib/functions";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { purgeAccountChats } from "../assistant/access";
import { purgeSpending } from "../assistant/spending";
import { purgeFiles } from "../assistant/files";
import { dropWorkspace, purgeWorkspace } from "../workspaces/purge";
import { purgeRatings } from "../ratings";
import { purgeReaders } from "../evidenceLibraries/readers";
import { purgeGrants } from "../sharing/upkeep";
import { purgeDeveloperApps } from "../developerApps/apps";

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
    // One account per transaction: each one's rows are bounded, but many together pass Convex's limits.
    const BATCH_SIZE = 1;

    // Only those past retention, so newer deletions can't block the queue in front of them.
    const deletedUsers = await ctx.db
      .query("users")
      .withIndex("by_state_and_updated_at", (q) => q.eq("state", "deleted").lt("updatedAt", cutoff))
      .take(BATCH_SIZE);

    let cleanedCount = 0;
    // An account whose rows didn't all fit this run stays, and the run after it finishes the job.
    let deferred = false;

    for (const user of deletedUsers) {
      // Their own workspace goes with them (#650); what they made in an organization stays the organization's.
      const workspace = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", user._id)).unique();
      // Clean up user's API keys
      const apiKeys = await ctx.db
        .query("apiKeys")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(MAX_API_KEYS_PER_USER);

      for (const key of apiKeys) {
        await ctx.db.delete("apiKeys", key._id);
      }

      // Delete their own workspace's extraction jobs (cascade to papers, results, evidence units, etc.)
      // Uses existing deleteExtractionInternal which handles all 9 child tables
      const extractionJobs = workspace
        ? await ctx.db.query("extractionJobs").withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id)).take(BATCH_SIZE)
        : [];
      for (const job of extractionJobs) {
        await ctx.scheduler.runAfter(0, internal.extraction.mutations.internal.admin.deleteExtractionInternal, {
          jobId: job._id,
        });
      }

      // If we found a full batch of extraction jobs, there may be more.
      // Don't delete the user yet -- re-schedule to handle remaining jobs.
      if (extractionJobs.length === BATCH_SIZE) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }

      // Delete Zotero connections (personal data, no audit value)
      const zoteroConns = await ctx.db
        .query("zoteroConnections")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(SINGLE_ROW_CLEANUP);
      for (const conn of zoteroConns) {
        await ctx.db.delete("zoteroConnections", conn._id);
      }
      if (zoteroConns.length === SINGLE_ROW_CLEANUP) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }

      // Their assistant chats go for everyone they were shared with, and so does their access to other people's.
      if (!(await purgeAccountChats(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // What they let the assistant spend in other people's chats goes too, and their own record with it.
      if (!(await purgeSpending(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // The files they attached go too, from their own chats and other people's.
      if (!(await purgeFiles(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // Their ratings are theirs alone: their own, and the ones they gave in collections.
      if (!(await purgeRatings(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // The Evidence Libraries they read.
      if (!(await purgeReaders(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // Their places as a guest of other workspaces' items.
      if (!(await purgeGrants(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // The sites they allowed, and the apps they made, here and in Clerk.
      if (!(await purgeDeveloperApps(ctx, user._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }
      // Everything else in their own workspace: searches, screenings, bookmarks, library and collections.
      if (workspace && !(await purgeWorkspace(ctx, workspace._id))) {
        deferred = true;
        continue; // Skip user delete, process on next run
      }

      if (workspace) await dropWorkspace(ctx, workspace._id);

      // The tombstone keeps who they were, in the transaction that deletes them, for what they made in organizations.
      const kept = { userId: user._id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email };
      const tombstone = await ctx.db.query("clerkDeletedUsers").withIndex("by_clerkId", (q) => q.eq("clerkId", user.clerkId)).unique();
      if (tombstone) await ctx.db.patch("clerkDeletedUsers", tombstone._id, kept);
      else await ctx.db.insert("clerkDeletedUsers", { clerkId: user.clerkId, deletedAt: user.updatedAt, ...kept });

      // Hard delete the user to prevent re-processing
      await ctx.db.delete("users", user._id);

      cleanedCount++;
    }

    // If we fetched a full batch, there might be more to process; a deferred account waits
    // a minute for the deletions this run scheduled.
    if (deletedUsers.length === BATCH_SIZE || deferred) {
      await ctx.scheduler.runAfter(deferred ? 60_000 : 0, internal.maintenance.mutations.cleanupDeletedUsers, {});
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} deleted users`);
    }
  },
});
