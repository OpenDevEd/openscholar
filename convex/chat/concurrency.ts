/**
 * Chat concurrency — two gates:
 *
 * 1. Per-thread gate (job.isGenerating): one assistant generation at a
 *    time per chat thread. Prevents double-submit races and keeps the
 *    streaming state machine deterministic.
 * 2. Per-user gate (tier-scaled cap): at most N concurrent in-flight
 *    chats across the caller's chat threads. Seeded at 3 everywhere in
 *    V1; see extraction/bucket/limits.ts::CHAT_CONCURRENCY_LIMIT_BY_PLAN.
 *
 * Zombie cleanup: if a Convex runtime death wipes out generateResponse
 * between acquire and the finally-release, the lock would never clear.
 * A 5-minute cron sweeps any row where isGenerating is still true and
 * generatingStartedAt > 5 minutes ago.
 */

import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { getChatConcurrencyLimit } from "../extraction/bucket/limits";

const STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * Counts a user's in-flight chats by scanning every chat-mode row under
 * the userId prefix. O(user's chat count) — if it becomes hot, promote
 * to a denormalised counter on the user row.
 */
async function countUserInFlightChats(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const chatJobs = await ctx.db
    .query("extractionJobs")
    .withIndex("by_user_mode_updated", (q) =>
      q.eq("userId", userId).eq("mode", "chat"),
    )
    .collect();
  return chatJobs.filter((j) => j.isGenerating === true).length;
}

/**
 * Internal mutation — called from sendMessage to atomically claim the
 * thread lock. Throws CONFLICT if:
 *   - this thread is already generating
 *   - the user is at their per-plan concurrency ceiling
 */
export const acquireThreadLock = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw createError("NOT_FOUND", "Job not found");
    }
    if (job.mode !== "chat") {
      throw createError(
        "VALIDATION_ERROR",
        "acquireThreadLock called on a non-chat job",
      );
    }
    if (job.isGenerating) {
      throw createError(
        "CONFLICT",
        "This chat is still generating",
      );
    }

    const limit = await getChatConcurrencyLimit(ctx, job.userId);
    const inFlight = await countUserInFlightChats(ctx, job.userId);
    if (inFlight >= limit) {
      throw createError(
        "CONFLICT",
        `You have reached the limit of ${limit} concurrent chats. Wait for one to finish.`,
      );
    }

    await ctx.db.patch(jobId, {
      isGenerating: true,
      generatingStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Internal mutation — idempotent lock release. Called from the
 * generateResponse action's `finally` block (fires on success, error,
 * or AI_INSUFFICIENT_CREDITS throw).
 */
export const releaseThreadLock = internalMutation({
  args: { jobId: v.id("extractionJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (!job.isGenerating) return null;
    await ctx.db.patch(jobId, {
      isGenerating: false,
      generatingStartedAt: undefined,
      shouldAbort: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * 5-minute cron entry point. Iterates every chat row with a stale lock
 * and clears it. `isGenerating` rows with fresh timestamps stay
 * untouched; unlocked rows are skipped by the index filter.
 */
export const cleanupZombieChatLocks = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_LOCK_MS;
    // No index on `isGenerating` alone; this sweep runs once every 5
    // minutes and chat rows are small relative to the full table, so a
    // table-wide scan is acceptable. Promote to a counter only if it
    // gets hot.
    let cleared = 0;
    for await (const row of ctx.db.query("extractionJobs")) {
      if (row.mode !== "chat") continue;
      if (!row.isGenerating) continue;
      if ((row.generatingStartedAt ?? 0) >= cutoff) continue;
      await ctx.db.patch(row._id, {
        isGenerating: false,
        generatingStartedAt: undefined,
        shouldAbort: undefined,
        updatedAt: Date.now(),
      });
      console.log(
        `[cleanupZombieChatLocks] cleared stale lock on ${row._id}`,
      );
      cleared += 1;
    }
    return { cleared };
  },
});
