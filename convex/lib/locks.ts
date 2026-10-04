/**
 * Per-user resource locks for interactive batch AI actions.
 *
 * Two primitives, parameterised by `kind`:
 *   - `acquireBatchLock`: throws BATCH_ACTION_ALREADY_RUNNING if an active
 *     row exists for `(userId, kind)`; GCs expired rows for the same
 *     `(userId, kind)` ad-hoc; inserts a fresh row with a TTL.
 *   - `releaseBatchLock`: idempotent delete by id.
 *
 * The release MUST run in `finally`. The action wrapper composes
 *   auth → rate-limit consume → acquire → try { handler } finally { release }
 * so a thrown handler still releases the lock and the rate-limit token is
 * consumed first (cheap fast-fail).
 *
 * Lock kind discriminator uses the underscore form (`"batch_screening"`)
 * to match the rest of the schema's literal-union convention; the
 * paired rate-limit bucket name uses the hyphen form
 * (`"batch-screening"`) to match the existing rate-limit bucket
 * convention. The asymmetry is intentional.
 */

import { SINGLE_ROW_CLEANUP } from "./queryBounds";
import { internalMutation } from "./functions";
import { v } from "convex/values";
import { createError } from "./errors";

export const BATCH_LOCK_TTL_MS = 10 * 60 * 1000; // 10 minutes

export type BatchLockKind = "batch_screening" | "batch_translation";

const batchLockKindValidator = v.union(
  v.literal("batch_screening"),
  v.literal("batch_translation"),
);

/**
 * Internal mutation — acquire an exclusive lock on `(userId, kind)`.
 * Throws BATCH_ACTION_ALREADY_RUNNING with `kind` in the payload when
 * an active (non-expired) lock exists. Garbage-collects expired rows
 * for the same key before inserting; no separate cron is needed
 * because the table is sparse and per-acquire cost is O(few).
 */
export const acquireBatchLock = internalMutation({
  args: {
    userId: v.id("users"),
    kind: batchLockKindValidator,
    ttlMs: v.number(),
  },
  returns: v.id("userResourceLocks"),
  handler: async (ctx, { userId, kind, ttlMs }) => {
    const now = Date.now();

    const existingActive = await ctx.db
      .query("userResourceLocks")
      .withIndex("by_user_kind_expires", (q) =>
        q.eq("userId", userId).eq("kind", kind).gt("expiresAt", now),
      )
      .first();

    if (existingActive) {
      throw createError(
        "BATCH_ACTION_ALREADY_RUNNING",
        `A ${kind} batch is already running for this user. Wait for it to finish or try again shortly.`,
        { kind },
      );
    }

    const expired = await ctx.db
      .query("userResourceLocks")
      .withIndex("by_user_kind_expires", (q) =>
        q.eq("userId", userId).eq("kind", kind).lte("expiresAt", now),
      )
      .take(SINGLE_ROW_CLEANUP);
    for (const row of expired) await ctx.db.delete(row._id);

    return await ctx.db.insert("userResourceLocks", {
      userId,
      kind,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    });
  },
});

/**
 * Internal mutation — idempotent release. The action wrapper calls
 * this in `finally`, so the lock id may already have been deleted by
 * a prior partial-failure path; no-op in that case.
 */
export const releaseBatchLock = internalMutation({
  args: { lockId: v.id("userResourceLocks") },
  returns: v.null(),
  handler: async (ctx, { lockId }) => {
    const existing = await ctx.db.get(lockId);
    if (!existing) return null;
    await ctx.db.delete(lockId);
    return null;
  },
});
