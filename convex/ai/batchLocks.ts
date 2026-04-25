import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { createError } from "../lib/errors";

const BATCH_SCREENING_LOCK_KIND = "batch_screening";

export const acquireBatchScreeningLock = internalMutation({
  args: {
    userId: v.id("users"),
    ttlMs: v.number(),
  },
  returns: v.object({
    lockId: v.id("aiBatchLocks"),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const activeLock = await ctx.db
      .query("aiBatchLocks")
      .withIndex("by_user_kind_expires", (q) =>
        q
          .eq("userId", args.userId)
          .eq("kind", BATCH_SCREENING_LOCK_KIND)
          .gt("expiresAt", now)
      )
      .first();

    if (activeLock) {
      throw createError(
        "SCREENING_JOB_ALREADY_ACTIVE",
        "You already have an active screening batch"
      );
    }

    const expiredLocks = await ctx.db
      .query("aiBatchLocks")
      .withIndex("by_user_kind", (q) =>
        q.eq("userId", args.userId).eq("kind", BATCH_SCREENING_LOCK_KIND)
      )
      .filter((q) => q.lte(q.field("expiresAt"), now))
      .collect();

    for (const lock of expiredLocks) {
      await ctx.db.delete(lock._id);
    }

    const lockId = await ctx.db.insert("aiBatchLocks", {
      userId: args.userId,
      kind: BATCH_SCREENING_LOCK_KIND,
      acquiredAt: now,
      expiresAt: now + args.ttlMs,
    });

    return { lockId };
  },
});

export const releaseBatchScreeningLock = internalMutation({
  args: {
    lockId: v.id("aiBatchLocks"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lock = await ctx.db.get(args.lockId);
    if (lock) {
      await ctx.db.delete(args.lockId);
    }
    return null;
  },
});
