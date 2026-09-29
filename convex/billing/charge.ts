/**
 * The one way OpenScholar spends credits. Work that costs credits reserves an
 * estimate first, then settles the real amount once it's known.
 *
 *   if (!(await reserveCredits(ctx, { userId, chargeId, credits: estimate }))) throw insufficient credits;
 *   try { ...work... } catch (e) { await releaseCredits(ctx, { userId, chargeId }); throw e; }
 *   await settleCredits(ctx, { userId, chargeId, credits: actual, usage });
 */
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { autumn, AutumnError } from "./autumn";
import { refreshAccount } from "./accounts";
import { billingUsageFields, usageKindValidator } from "./validators";
import { recordJobCredits } from "../extraction/aggregates";
import { insertUsage } from "./usageLog";
import type { Usage } from "../../lib/ai/core/types";

/** Long enough for any single chat turn, paper, or batch we run. */
const DEFAULT_HOLD_MS = 30 * 60_000;

/** When to try a failed settle or release again; Autumn may be briefly down. */
const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

function isLockNotFound(error: unknown): boolean {
  return (
    error instanceof AutumnError &&
    error.status === 400 &&
    JSON.stringify(error.body).includes("Lock not found")
  );
}

/**
 * Holds `credits` for `chargeId`. Returns false, holding nothing, when the
 * balance can't cover it. Self-hosted Autumn never expires locks, so a release
 * is scheduled for the expiry time; it does nothing once the charge settles.
 */
export async function reserveCredits(
  ctx: ActionCtx,
  args: { userId: Id<"users">; chargeId: string; credits: number; holdMs?: number },
): Promise<boolean> {
  if (args.credits <= 0) return true;
  const expiresAt = Date.now() + (args.holdMs ?? DEFAULT_HOLD_MS);
  await ctx.scheduler.runAt(expiresAt, internal.billing.charge.releaseLock, {
    userId: args.userId,
    chargeId: args.chargeId,
    attempt: 0,
  });
  const result = await autumn.lock({
    customerId: args.userId,
    credits: args.credits,
    lockId: args.chargeId,
    expiresAt,
  });
  return result.allowed;
}

async function releaseHold(chargeId: string): Promise<void> {
  try {
    await autumn.finalize(chargeId, "release");
  } catch (error) {
    if (!isLockNotFound(error)) throw error;
  }
}

/** Gives back whatever `chargeId` still holds. */
export async function releaseCredits(
  ctx: ActionCtx,
  args: { userId: Id<"users">; chargeId: string },
): Promise<void> {
  await releaseHold(args.chargeId);
  await refreshAccount(ctx, args.userId);
}

export const releaseLock = internalAction({
  args: { userId: v.id("users"), chargeId: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await releaseCredits(ctx, args);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[args.attempt];
      if (delay === undefined) {
        console.error(`[billing] gave up releasing ${args.chargeId}`, error);
        return null;
      }
      await ctx.scheduler.runAfter(delay, internal.billing.charge.releaseLock, {
        ...args,
        attempt: args.attempt + 1,
      });
    }
    return null;
  },
});

const usageDetailsValidator = v.object({
  kind: usageKindValidator,
  description: v.string(),
  jobId: v.optional(v.id("extractionJobs")),
  model: v.optional(v.string()),
  costUsd: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
});
/** What a charge records about the tokens behind it. */
export function tokenDetails(usage: Usage) {
  return {
    ...(usage.costUsd !== undefined && { costUsd: usage.costUsd }),
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  };
}

const settleValidator = v.object({
  userId: v.id("users"),
  chargeId: v.string(),
  credits: v.number(),
  usage: usageDetailsValidator,
});
type SettleArgs = Infer<typeof settleValidator>;

/**
 * Charges `credits` for `chargeId` and records what Autumn deducted. The hold
 * is released and the whole amount charged in one idempotent, zero-capped
 * call, so settling twice charges once. A failure is retried in the background.
 * ponytail: a parallel reservation can take the released credits before the
 * charge lands, undercharging only when the balance is nearly empty.
 */
export async function settleCredits(ctx: ActionCtx, args: SettleArgs): Promise<void> {
  try {
    await settleOnce(ctx, args);
  } catch (error) {
    console.error(`[billing] settling ${args.chargeId} failed; retrying`, error);
    await ctx.scheduler.runAfter(RETRY_DELAYS_MS[0], internal.billing.charge.retrySettle, {
      ...args,
      attempt: 1,
    });
  }
}

async function settleOnce(ctx: ActionCtx, args: SettleArgs): Promise<void> {
  if (await ctx.runQuery(internal.billing.charge.isSettled, { chargeId: args.chargeId })) return;
  await releaseHold(args.chargeId);
  const credits = Math.max(0, args.credits);
  if (credits > 0) {
    let charged: number;
    try {
      const result = await autumn.track({
        customerId: args.userId,
        credits,
        idempotencyKey: args.chargeId,
      });
      charged = result.deductions.reduce((sum, deduction) => sum + deduction.value, 0);
    } catch (error) {
      if (!(error instanceof AutumnError && error.status === 409)) throw error;
      // An earlier attempt charged it, then failed before recording it.
      charged = credits;
    }
    await ctx.runMutation(internal.billing.charge.recordUsage, {
      userId: args.userId,
      chargeId: args.chargeId,
      credits: charged,
      ...args.usage,
      createdAt: Date.now(),
    });
  }
  await refreshAccount(ctx, args.userId);
}

export const retrySettle = internalAction({
  args: { ...settleValidator.fields, attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { attempt, ...args }) => {
    try {
      await settleOnce(ctx, args);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        console.error(`[billing] gave up settling ${args.chargeId}`, error);
        return null;
      }
      await ctx.scheduler.runAfter(delay, internal.billing.charge.retrySettle, {
        ...args,
        attempt: attempt + 1,
      });
    }
    return null;
  },
});

export const isSettled = internalQuery({
  args: { chargeId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { chargeId }) =>
    (await ctx.db
      .query("billingUsage")
      .withIndex("by_charge", (q) => q.eq("chargeId", chargeId))
      .first()) !== null,
});

export const recordUsage = internalMutation({
  args: billingUsageFields,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingUsage")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .first();
    if (existing) return false;
    await insertUsage(ctx, args);
    if (args.jobId) {
      await recordJobCredits(ctx, {
        jobId: args.jobId,
        chargeId: args.chargeId,
        credits: args.credits,
      });
    }
    return true;
  },
});
