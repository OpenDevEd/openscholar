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
 *
 * A job the person approved up to a figure (#328) holds that figure once
 * (`holdSpend`). Each of its items writes its cost to the ledger under the hold
 * and charges nothing (`spendUnder`), and the hold is confirmed once with their
 * sum when the job ends (`settleSpent`), as Firecrawl locks a monitor check's
 * estimate and confirms the lock with the pages' real total. A job uses one
 * path or the other, never both.
 */
import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "../lib/functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { autumn, AutumnError } from "./autumn";
import { requestRefresh, zeroCachedBalance } from "./accounts";
import { billingUsageFields, usageKindValidator } from "./validators";
import { insertUsage } from "./ledger";
import type { Usage } from "../../lib/ai/core/types";

/** Long enough for any single chat turn, paper, or batch we run. */
const DEFAULT_HOLD_MS = 30 * 60_000;

/**
 * How long an approved job's hold stands by itself: longer than a job runs. A job that
 * never ends has its hold settled then with what it spent, so nothing spent under it goes uncharged.
 */
const SPEND_HOLD_MS = 24 * 60 * 60_000;
/** Charges summed in one read of what was spent under a hold. */
const SPENT_PAGE = 500;

/** When to try a failed settle or release again; Autumn may be briefly down. */
const RETRY_DELAYS_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/**
 * When a settle that cancelled its hold's release runs again regardless, in
 * case its action ended before finishing or scheduling a retry. It does
 * nothing once the charge is recorded.
 */
const SETTLE_BACKSTOP_MS = 5 * 60_000;

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
  args: { userId: v.id("users"), chargeId: v.string(), credits: v.number(), expiresAt: v.number(), spend: v.optional(v.literal(true)) },
  returns: v.null(),
  handler: async (ctx, { userId, chargeId, credits, expiresAt, spend }) => {
    // A job's hold has charges recorded under it: left standing, it is settled with them, never given back whole.
    const release = spend
      ? await ctx.scheduler.runAt(expiresAt, internal.billing.charge.settleSpent, { chargeId, attempt: 0 })
      : await ctx.scheduler.runAt(expiresAt, internal.billing.charge.releaseLock, { userId, chargeId, attempt: 0 });
    await ctx.db.insert("billingHolds", { userId, chargeId, credits, release, ...(spend ? { spend } : {}) });
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
  args: { userId: Id<"users">; chargeId: string; credits: number; holdMs?: number; spend?: true },
): Promise<boolean> {
  if (args.credits <= 0) return true;
  const expiresAt = Date.now() + (args.holdMs ?? DEFAULT_HOLD_MS);
  await ctx.runMutation(internal.billing.charge.hold, {
    userId: args.userId,
    chargeId: args.chargeId,
    credits: args.credits,
    expiresAt,
    ...(args.spend ? { spend: args.spend } : {}),
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
 * however often it runs. A failure is retried in the background; it returns
 * false then, as the charge hasn't landed yet.
 */
export async function settleCredits(ctx: ActionCtx, args: SettleArgs): Promise<boolean> {
  try {
    await settleOnce(ctx, args);
    return true;
  } catch (error) {
    console.error(`[billing] settling ${args.chargeId} failed; retrying`, error);
    await ctx.scheduler.runAfter(RETRY_DELAYS_MS[0], internal.billing.charge.retrySettle, {
      ...args,
      attempt: 1,
    });
    return false;
  }
}

/**
 * Starts settling `chargeId`. A charge still held, its release cancelled
 * here, is confirmed; one whose release ran, or that never held anything, is
 * tracked. A settle that confirmed and then failed finds its hold cancelled
 * and confirms again, so "Lock not found" then means it already landed.
 */
export const beginSettle = internalMutation({
  args: settleValidator.fields,
  returns: v.union(
    v.object({ kind: v.literal("settled") }),
    v.object({ kind: v.literal("held"), credits: v.number(), rest: v.boolean() }),
    v.object({ kind: v.literal("unheld") }),
  ),
  handler: async (ctx, args) => {
    if (await usageFor(ctx, args.chargeId)) return { kind: "settled" as const };
    const row = await holdFor(ctx, args.chargeId);
    if (!row) return { kind: "unheld" as const };
    const release = (await ctx.db.system.get(row.release))?.state.kind;
    if (release === "pending") {
      // The release was the hold's only scheduled way out; the backstop replaces it.
      await ctx.scheduler.cancel(row.release);
      await ctx.scheduler.runAfter(SETTLE_BACKSTOP_MS, internal.billing.charge.retrySettle, { ...args, attempt: 1 });
    }
    if (release === "pending" || release === "canceled") {
      return { kind: "held" as const, credits: row.credits, rest: row.rest === true };
    }
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

/** Marks a hold as confirming as it stands with the rest charged separately. */
export const markRest = internalMutation({
  args: { chargeId: v.string() },
  returns: v.null(),
  handler: async (ctx, { chargeId }) => {
    const row = await holdFor(ctx, chargeId);
    if (row) await ctx.db.patch("billingHolds", row._id, { rest: true });
    return null;
  },
});

/** Confirms a hold as it stands; a lock that's gone was confirmed already. */
async function confirmAsHeld(chargeId: string) {
  try {
    await autumn.finalize(chargeId, "confirm");
  } catch (error) {
    if (!isLockNotFound(error)) throw error;
  }
}

/**
 * Confirms a hold at the real amount. When that's more than the hold and the
 * rest of the balance, Autumn refuses it; the hold is marked, confirmed as it
 * stands, and the rest charged down to zero. A retry of a marked hold repeats
 * those two idempotent steps.
 */
async function confirm(ctx: ActionCtx, args: Pick<SettleArgs, "userId" | "chargeId" | "credits">, held: number, rest: boolean) {
  if (!rest) {
    try {
      await autumn.finalize(args.chargeId, "confirm", args.credits);
      return args.credits;
    } catch (error) {
      // The release was cancelled when settling began, so a gone lock was confirmed by an earlier attempt.
      if (isLockNotFound(error)) return args.credits;
      if (!isInsufficientBalance(error)) throw error;
    }
    await ctx.runMutation(internal.billing.charge.markRest, { chargeId: args.chargeId });
  }
  await confirmAsHeld(args.chargeId);
  return held + (await track(args.userId, `${args.chargeId}:rest`, args.credits - held)).charged;
}

/**
 * Charges a charge with no hold of its own. When the balance falls short, a
 * lock may still hold this charge's credits (one reserved before holds were
 * recorded, or a release still running); it's released and the rest charged.
 */
async function trackUnheld(args: SettleArgs) {
  const first = await track(args.userId, args.chargeId, args.credits);
  if (first.charged >= args.credits) return first;
  await releaseHold(args.chargeId);
  const rest = await track(args.userId, `${args.chargeId}:rest`, args.credits - first.charged);
  return { charged: first.charged + rest.charged, remaining: rest.remaining };
}

async function settleOnce(ctx: ActionCtx, args: SettleArgs): Promise<void> {
  const state = await ctx.runMutation(internal.billing.charge.beginSettle, args);
  if (state.kind === "settled") return;
  const credits = Math.max(0, args.credits);
  if (credits === 0) {
    // Nothing to charge; give back the hold, or a lock reserved before holds were recorded.
    await releaseCredits(ctx, args);
    return;
  }
  const charge = { ...args, credits };
  const { charged, remaining } =
    state.kind === "held"
      ? { charged: await confirm(ctx, charge, state.credits, state.rest), remaining: undefined }
      : await trackUnheld(charge);
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
        // The hold's release was cancelled when settling began; give it back, with its own retries.
        await ctx.scheduler.runAfter(0, internal.billing.charge.releaseLock, {
          userId: args.userId,
          chargeId: args.chargeId,
          attempt: 0,
        });
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
    // Counting it, its job's credits, and re-reading the account are the ledger worker's.
    await insertUsage(ctx, args);
    const row = await holdFor(ctx, args.chargeId);
    if (row) await ctx.db.delete("billingHolds", row._id);
    if (remaining !== undefined && remaining <= 0) await zeroCachedBalance(ctx, args.userId);
    return true;
  },
});

/**
 * Holds the most an approved job may spend (#328). False, holding nothing, when the balance
 * can't cover it. The job keeps `chargeId`: its items are charged under it (`settleUnder`),
 * and it is settled once, when the job ends (./spend.ts).
 */
export const holdSpend = (ctx: ActionCtx, args: { userId: Id<"users">; chargeId: string; credits: number }) =>
  reserveCredits(ctx, { ...args, holdMs: SPEND_HOLD_MS, spend: true });

/**
 * Writes an item's cost to the ledger under its job's hold, charging nothing. False when the
 * hold is gone or is being settled: the item then pays its own way.
 */
export const recordUnder = internalMutation({
  args: { ...billingUsageFields, under: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await holdFor(ctx, args.under);
    if (!row?.spend || row.settling) return false;
    if (!(await usageFor(ctx, args.chargeId))) await insertUsage(ctx, args);
    return true;
  },
});

/**
 * Charges an item of a job: under the job's hold when it has one still standing, by itself
 * otherwise, as `settleCredits` does. An item that finishes after its job's hold was settled
 * is one of those.
 */
export async function settleUnder(ctx: ActionCtx, { under, ...args }: SettleArgs & { under?: string }): Promise<boolean> {
  if (under === undefined) return await settleCredits(ctx, args);
  if (args.credits <= 0) return true;
  const { usage, ...charge } = args;
  if (await ctx.runMutation(internal.billing.charge.recordUnder, { ...charge, ...usage, under, createdAt: Date.now() })) return true;
  return await settleCredits(ctx, args);
}

/**
 * Starts settling an approved job's hold. From here nothing more is recorded under it, so
 * what was spent under it is final. Its own settling at expiry is cancelled, and a backstop
 * runs the settling again in case this run ends before it finishes.
 */
export const beginSpent = internalMutation({
  args: { chargeId: v.string() },
  returns: v.union(v.null(), v.object({ userId: v.id("users"), credits: v.number(), rest: v.boolean() })),
  handler: async (ctx, { chargeId }) => {
    const row = await holdFor(ctx, chargeId);
    if (!row?.spend) return null;
    if (!row.settling) {
      if ((await ctx.db.system.get(row.release))?.state.kind === "pending") await ctx.scheduler.cancel(row.release);
      await ctx.scheduler.runAfter(SETTLE_BACKSTOP_MS, internal.billing.charge.settleSpent, { chargeId, attempt: 1 });
      await ctx.db.patch("billingHolds", row._id, { settling: true });
    }
    return { userId: row.userId, credits: row.credits, rest: row.rest === true };
  },
});

/** What a page of the charges recorded under a hold comes to. */
export const spentUnder = internalQuery({
  args: { under: v.string(), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ credits: v.number(), cursor: v.string(), done: v.boolean() }),
  handler: async (ctx, { under, cursor }) => {
    const read = await ctx.db
      .query("billingUsage")
      .withIndex("by_under", (q) => q.eq("under", under))
      .paginate({ cursor, numItems: SPENT_PAGE });
    return { credits: read.page.reduce((sum, row) => sum + row.credits, 0), cursor: read.continueCursor, done: read.isDone };
  },
});

/**
 * Confirms an approved job's hold with what was spent under it, once, and forgets it. With
 * nothing spent, it is given back. It runs when the job ends, and at the hold's expiry if
 * the hold is still standing then.
 */
export const settleSpent = internalAction({
  args: { chargeId: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { chargeId, attempt }) => {
    const held = await ctx.runMutation(internal.billing.charge.beginSpent, { chargeId });
    if (!held) return null;
    try {
      let spent = 0;
      let cursor: string | null = null;
      for (let done = false; !done; ) {
        const read: { credits: number; cursor: string; done: boolean } = await ctx.runQuery(internal.billing.charge.spentUnder, { under: chargeId, cursor });
        spent += read.credits;
        ({ cursor, done } = read);
      }
      if (spent > 0) await confirm(ctx, { userId: held.userId, chargeId, credits: spent }, held.credits, held.rest);
      else await releaseHold(chargeId);
      await ctx.runMutation(internal.billing.charge.endHold, { chargeId });
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        console.error(`[billing] gave up settling what was spent under ${chargeId}`, error);
        // Its settling at expiry was cancelled when this began: give the hold back, with its own retries.
        await ctx.scheduler.runAfter(0, internal.billing.charge.releaseLock, { userId: held.userId, chargeId, attempt: 0 });
        return null;
      }
      await ctx.scheduler.runAfter(delay, internal.billing.charge.settleSpent, { chargeId, attempt: attempt + 1 });
    }
    return null;
  },
});
