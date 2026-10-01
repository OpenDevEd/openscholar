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
 * A running generation renews its lock (`generatingStartedAt`) every
 * LEASE_RENEW_MS, so a lock not renewed within STALE_LOCK_MS belongs to
 * a generation that died: it stops counting against the user's limit,
 * and a 5-minute cron (convex/crons.ts) releases it.
 */

import {
  internalMutation,
  type MutationCtx,
} from "../lib/functions";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { CHAT_CONCURRENCY_LIMIT } from "@/lib/extraction/limits";

const STALE_LOCK_MS = 5 * 60 * 1000;
/** How often a running generation renews its lock: well inside STALE_LOCK_MS. */
export const LEASE_RENEW_MS = 60 * 1000;

/**
 * A user's chats generating now, up to `limit`: only chats whose lock is
 * younger than STALE_LOCK_MS, read from the index of generating chats.
 */
async function countUserInFlightChats(
  ctx: MutationCtx,
  userId: Id<"users">,
  limit: number,
): Promise<number> {
  const cutoff = Date.now() - STALE_LOCK_MS;
  const generating = await ctx.db
    .query("extractionJobs")
    .withIndex("by_user_and_mode_and_isGenerating_and_generatingStartedAt", (q) =>
      q.eq("userId", userId).eq("mode", "chat").eq("isGenerating", true).gte("generatingStartedAt", cutoff),
    )
    .take(limit);
  return generating.length;
}

export async function assertChatConcurrencyAvailable(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const limit = CHAT_CONCURRENCY_LIMIT;
  const inFlight = await countUserInFlightChats(ctx, userId, limit);
  if (inFlight >= limit) {
    throw createError(
      "CONFLICT",
      `You have reached the limit of ${limit} concurrent chats. Wait for one to finish.`,
    );
  }
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

    await assertChatConcurrencyAvailable(ctx, job.userId);

    await ctx.db.patch(jobId, {
      isGenerating: true,
      generatingStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Renews a running generation's lock, while it's still that generation's. */
export const renewGenerationLease = internalMutation({
  args: { jobId: v.id("extractionJobs"), generationAttemptId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { jobId, generationAttemptId }) => {
    const job = await ctx.db.get(jobId);
    if (!job?.isGenerating) return null;
    if (generationAttemptId !== undefined && job.chatGenerationAttemptId !== generationAttemptId) return null;
    await ctx.db.patch(jobId, { generatingStartedAt: Date.now() });
    return null;
  },
});

/**
 * Internal mutation — idempotent lock release. Called from the
 * generateResponse action's `finally` block (fires on success, error,
 * or AI_INSUFFICIENT_CREDITS throw).
 */
export const releaseThreadLock = internalMutation({
  args: {
    jobId: v.id("extractionJobs"),
    generationAttemptId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, generationAttemptId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (!job.isGenerating) return null;
    if (
      generationAttemptId !== undefined &&
      job.chatGenerationAttemptId !== generationAttemptId
    ) {
      return null;
    }
    await ctx.db.patch(jobId, {
      isGenerating: false,
      generatingStartedAt: undefined,
      chatGenerationAttemptId: undefined,
      shouldAbort: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Stale locks one sweep releases; a larger backlog clears over the following runs. */
const SWEEP_BATCH = 200;

/**
 * 5-minute cron entry point (convex/crons.ts). Releases chat locks older
 * than STALE_LOCK_MS, read from the index of generating chats, so fresh
 * locks and finished chats are never read.
 */
export const cleanupZombieChatLocks = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_LOCK_MS;
    let cleared = 0;
    const stale = await ctx.db
      .query("extractionJobs")
      .withIndex("by_mode_and_isGenerating_and_generatingStartedAt", (q) =>
        q.eq("mode", "chat").eq("isGenerating", true).lt("generatingStartedAt", cutoff),
      )
      .take(SWEEP_BATCH);
    for (const row of stale) {
      await ctx.db.patch(row._id, {
        isGenerating: false,
        generatingStartedAt: undefined,
        chatGenerationAttemptId: undefined,
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
