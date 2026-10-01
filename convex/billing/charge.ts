/**
 * The one way OpenScholar spends credits, following Autumn's balance locking
 * (docs.useautumn.com/documentation/customers/balance-locking). Work whose
 * cost isn't known up front holds an estimate first, then settles the real
 * amount once it's known:
 *
 *   if (!(await reserveCredits(ctx, { userId, chargeId, credits: estimate }))) throw insufficient credits;
 *   try { ...work... } catch (e) { await releaseCredits(ctx, { userId, chargeId }); throw e; }
 *   await settleCredits(ctx, { userId, chargeId, credits: actual, usage });
 *
 * Bulk work of small, bounded items (a Screen all paper) holds nothing and
 * settles each item with one `track`, as Firecrawl bills each page of a crawl.
 */
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, type ActionCtx, type MutationCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { autumn, AutumnError } from "./autumn";
import { readAccount, requestRefresh } from "./accounts";
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

/** A confirm for more than the hold and the rest of the balance. */
function isInsufficientBalance(error: unknown): boolean {
  return error instanceof AutumnError && /insufficient_balance/i.test(JSON.stringify(error.body));
}

async function holdFor(ctx: MutationCtx, chargeId: string) {
  return await ctx.db
    .query("billingHolds")
    .withIndex("by_charge", (q) => q.eq("chargeId", chargeId))
    .unique();
}

async function usageFor(ctx: MutationCtx, chargeId: string) {
  return await ctx.db
    .query("billingUsage")
    .withIndex("by_charge", (q) => q.eq("chargeId", chargeId))
    .first();
}

/**
 * Records a hold before Autumn takes it. Self-hosted Autumn never expires
 * locks, so the hold schedules its own release at the expiry time; settling
 * cancels it.
 */
export const hold = internalMutation({
  args: { userId: v.id("users"), chargeId: v.string(), credits: v.number(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { userId, chargeId, credits, expiresAt }) => {
    const release = await ctx.scheduler.runAt(expiresAt, internal.billing.charge.releaseLock, {
      userId,
      chargeId,
      attempt: 0,
    });
    await ctx.db.insert("billingHolds", { userId, chargeId, credits, release });
    return null;
  },
});

/** Forgets a hold that's gone from Autumn, and its release. */
export const endHold = internalMutation({
  args: { chargeId: v.string() },
  returns: v.null(),
  handler: async (ctx, { chargeId }) => {
    const row = await holdFor(ctx, chargeId);
    if (!row) return null;
    if ((await ctx.db.system.get(row.release))?.state.kind === "pending") await ctx.scheduler.cancel(row.release);
    await ctx.db.delete("billingHolds", row._id);
    await requestRefresh(ctx, row.userId);
    return null;
  },
});

/**
 * Holds `credits` for `chargeId`. Returns false, holding nothing, when the
 * balance can't cover it.
 */
export async function reserveCredits(
  ctx: ActionCtx,
  args: { userId: Id<"users">; chargeId: string; credits: number; holdMs?: number },
): Promise<boolean> {
  if (args.credits <= 0) return true;
  const expiresAt = Date.now() + (args.holdMs ?? DEFAULT_HOLD_MS);
  await ctx.runMutation(internal.billing.charge.hold, {
    userId: args.userId,
    chargeId: args.chargeId,
    credits: args.credits,
    expiresAt,
  });
  const result = await autumn.lock({
    customerId: args.userId,
    credits: args.credits,
    lockId: args.chargeId,
    expiresAt,
  });
  if (!result.allowed) await ctx.runMutation(internal.billing.charge.endHold, { chargeId: args.chargeId });
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
  await ctx.runMutation(internal.billing.charge.endHold, { chargeId: args.chargeId });
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
/** The cache and reasoning token counts a charge records. */
export function tokenCounts(usage: Usage) {
  return {
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  };
}

/** What a charge records about the tokens behind it. */
export function tokenDetails(usage: Usage) {
  return { ...(usage.costUsd !== undefined && { costUsd: usage.costUsd }), ...tokenCounts(usage) };
}

const settleValidator = v.object({
  userId: v.id("users"),
  chargeId: v.string(),
  credits: v.number(),
  usage: usageDetailsValidator,
});
type SettleArgs = Infer<typeof settleValidator>;

/**
 * Charges `credits` for `chargeId` and records what Autumn deducted, once
 * however often it runs. A failure is retried in the background.
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

/**
 * Starts settling `chargeId`. A charge still held, its release cancelled
 * here, is confirmed; one whose release ran, or that never held anything, is
 * tracked. A settle that confirmed and then failed finds its hold cancelled
 * and confirms again, so "Lock not found" then means it already landed.
 */
export const beginSettle = internalMutation({
  args: { chargeId: v.string() },
  returns: v.union(
    v.object({ kind: v.literal("settled") }),
    v.object({ kind: v.literal("held"), credits: v.number() }),
    v.object({ kind: v.literal("unheld") }),
  ),
  handler: async (ctx, { chargeId }) => {
    if (await usageFor(ctx, chargeId)) return { kind: "settled" as const };
    const row = await holdFor(ctx, chargeId);
    if (!row) return { kind: "unheld" as const };
    const release = (await ctx.db.system.get(row.release))?.state.kind;
    if (release === "pending") await ctx.scheduler.cancel(row.release);
    if (release === "pending" || release === "canceled") return { kind: "held" as const, credits: row.credits };
    return { kind: "unheld" as const };
  },
});

/** Charges up to `credits` with one idempotent `track`, stopping at a zero balance. */
async function track(userId: Id<"users">, key: string, credits: number) {
  try {
    const result = await autumn.track({ customerId: userId, credits, idempotencyKey: key });
    return {
      charged: result.deductions.reduce((sum, deduction) => sum + deduction.value, 0),
      remaining: result.balance?.remaining,
    };
  } catch (error) {
    if (!(error instanceof AutumnError && error.status === 409)) throw error;
    // An earlier attempt charged it, then failed before recording it.
    return { charged: credits, remaining: undefined };
  }
}

/**
 * Confirms a hold at the real amount. When that's more than the hold and the
 * rest of the balance, Autumn refuses it; the hold is confirmed as it stands
 * and the rest charged down to zero.
 * ponytail: a settle that fails between those two calls finds the lock gone
 * on its retry and records the full amount without charging the rest; it
 * needs a nearly empty balance and a failure in that gap.
 */
async function confirm(userId: Id<"users">, chargeId: string, credits: number, held: number) {
  try {
    await autumn.finalize(chargeId, "confirm", credits);
    return credits;
  } catch (error) {
    if (isLockNotFound(error)) return credits;
    if (!isInsufficientBalance(error)) throw error;
  }
  try {
    await autumn.finalize(chargeId, "confirm");
  } catch (error) {
    if (!isLockNotFound(error)) throw error;
  }
  return held + (await track(userId, `${chargeId}:rest`, credits - held)).charged;
}

async function settleOnce(ctx: ActionCtx, args: SettleArgs): Promise<void> {
  const state = await ctx.runMutation(internal.billing.charge.beginSettle, { chargeId: args.chargeId });
  if (state.kind === "settled") return;
  const credits = Math.max(0, args.credits);
  if (credits === 0) {
    if (state.kind === "held") await releaseCredits(ctx, args);
    return;
  }
  const { charged, remaining } =
    state.kind === "held"
      ? { charged: await confirm(args.userId, args.chargeId, credits, state.credits), remaining: undefined }
      : await track(args.userId, args.chargeId, credits);
  await ctx.runMutation(internal.billing.charge.recordUsage, {
    userId: args.userId,
    chargeId: args.chargeId,
    credits: charged,
    ...args.usage,
    createdAt: Date.now(),
    ...(remaining !== undefined && { remaining }),
  });
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
        // The hold's release was cancelled when settling began; give it back.
        await releaseCredits(ctx, args).catch((releaseError) =>
          console.error(`[billing] releasing ${args.chargeId} after giving up failed`, releaseError),
        );
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

/**
 * Logs a settled charge and forgets its hold. `remaining` is the balance
 * Autumn reported after a `track`; at zero the cached balance is zeroed now,
 * so parallel work stops before the queued refresh lands.
 */
export const recordUsage = internalMutation({
  args: { ...billingUsageFields, remaining: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, { remaining, ...args }) => {
    if (await usageFor(ctx, args.chargeId)) return false;
    await insertUsage(ctx, args);
    if (args.jobId) {
      await recordJobCredits(ctx, {
        jobId: args.jobId,
        chargeId: args.chargeId,
        credits: args.credits,
      });
    }
    const row = await holdFor(ctx, args.chargeId);
    if (row) await ctx.db.delete("billingHolds", row._id);
    const account = remaining !== undefined && remaining <= 0 ? await readAccount(ctx, args.userId) : null;
    if (account && account.balance > 0) await ctx.db.patch("billingAccounts", account._id, { balance: 0 });
    await requestRefresh(ctx, args.userId);
    return true;
  },
});
