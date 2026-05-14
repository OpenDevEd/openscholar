/**
 * Tier D append-only reservation primitive.
 *
 * Rate-limiter-shaped contract: `reserve(estimate)` returns a handle that
 * holds credits against the user's balance via signed-negative
 * `creditTransactions` rows. The caller does the work, then either
 * `settle(handle, actualCost)` to replace the hold with a real usage
 * charge, or `release(handle)` to cancel and free the hold. Both
 * settlement paths are pure inserts — `credits` is never patched — so
 * concurrent reservations across fan-out callers shard their balance
 * delta across 16 sharded-counter rows per pool and never OCC-contend
 * on a shared cell.
 *
 * Data model:
 *   - A reservation that fits in one pool produces ONE `reservation` row.
 *   - A reservation that spans both pools (free covers part, paid the
 *     rest) produces TWO rows: the free row is the "primary" (its `_id`
 *     is the caller-facing handle), the paid row carries
 *     `reservationOf: <primaryId>` linking it to the group.
 *   - `release` inserts one `reservation_release` per active member of
 *     the group, each carrying `reservationOf: <memberRow._id>` so the
 *     offset is traceable back to the specific hold it cancels.
 *   - `settle` = `release` + `deductCreditsTransaction(actualCost)`. The
 *     actuals deduction runs against the post-release balance (free-
 *     first allocation), so the user pays the true cost regardless of
 *     whether the estimate was high or low.
 *
 * Idempotency:
 *   - `release` is idempotent. Each reservation row is probed via the
 *     `by_reservationOf` index for an existing `reservation_release`; if
 *     present the offset insert is skipped. Safe to call from retry
 *     paths, cleanup workers, and error handlers.
 *   - `settle` is NOT idempotent. The release half is idempotent, but
 *     the actuals deduction always inserts. Callers must gate at most
 *     one settlement per reservation via their own state machine
 *     (matching the chat-billing pattern where `chatGenerationUsages.status`
 *     transitions from `captured` → `billed` exactly once).
 *
 * Concurrency:
 *   - `reserve` reads the balance via `readBalance` (sharded-counter
 *     `count()` over both pools) then inserts. If two parallel callers
 *     race for the last 100 credits, Convex OCC re-runs the loser
 *     whenever its read-set overlaps the winner's write-set on a counter
 *     shard; the replay sees the post-write balance, `balance.total <
 *     amount`, and throws `INSUFFICIENT_CREDITS`.
 *   - The handle returned by `reserve` is stable across retries: a
 *     mutation retry produces the same final `_id` because the row is
 *     only persisted on commit.
 */

import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { recordTransactionCounters } from "./aggregates";
import { readBalance } from "./balanceCounter";
import { billingTypeValidator } from "../lib/validators";
import { deductCreditsTransaction, type DeductCreditsResult } from "./internal";

type ReservationScope = {
  description?: string;
  jobId?: Id<"extractionJobs">;
  paperId?: Id<"extractionPapers">;
  resultId?: Id<"extractionResults">;
  billingType?: Doc<"creditTransactions">["billingType"];
  metadata?: Record<string, string>;
};

export type ReserveCreditsArgs = ReservationScope & {
  userId: Id<"users">;
  amount: number;
};

export type ReserveCreditsResult = {
  /**
   * Handle for `release` / `settle`. The `_id` of the primary reservation
   * row (the free-pool row when both pools are used; the sole row
   * otherwise). `null` only when `amount === 0`, in which case the caller
   * has nothing to release.
   */
  reservationId: Id<"creditTransactions"> | null;
  reserved: number;
  remaining: number;
};

const RESERVATION_DESCRIPTION_FALLBACK = "Credit reservation";

/**
 * Reserve `amount` credits via append-only ledger inserts. Free pool is
 * drained first; any remainder lands on paid. Throws
 * `INSUFFICIENT_CREDITS` if the wallet can't cover the estimate — there
 * is no `allowPartial` here because a reservation IS the pre-flight gate.
 */
export async function reserveCreditsTransaction(
  ctx: MutationCtx,
  args: ReserveCreditsArgs,
): Promise<ReserveCreditsResult> {
  if (args.amount < 0) {
    throw new ConvexError({
      code: "INVALID_AMOUNT",
      message: "Reservation amount must be non-negative",
    });
  }

  const credits = await ctx.db
    .query("credits")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique();

  if (!credits) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Credits record not found",
    });
  }

  if (args.amount === 0) {
    const balance = await readBalance(ctx, credits._id);
    return { reservationId: null, reserved: 0, remaining: balance.total };
  }

  const balance = await readBalance(ctx, credits._id);
  if (balance.total < args.amount) {
    throw new ConvexError({
      code: "INSUFFICIENT_CREDITS",
      message: `Insufficient credits to reserve: need ${args.amount}, have ${balance.total}`,
    });
  }

  const now = Date.now();
  const description = args.description ?? RESERVATION_DESCRIPTION_FALLBACK;

  const freeReserved = Math.min(balance.free, args.amount);
  const paidReserved = args.amount - freeReserved;

  const scope = {
    jobId: args.jobId,
    paperId: args.paperId,
    resultId: args.resultId,
    billingType: args.billingType,
    metadata: args.metadata,
  };

  // Insert the primary row first so the secondary can link to it via
  // `reservationOf`. When only one pool is used the primary is that pool;
  // otherwise the free row is primary (matching the free-first allocation
  // order of `deductCreditsTransaction` for audit symmetry).
  let primaryId: Id<"creditTransactions"> | null = null;

  if (freeReserved > 0) {
    primaryId = await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      userId: args.userId,
      type: "reservation",
      creditType: "free",
      amount: -freeReserved,
      description,
      createdAt: now,
      ...scope,
    });
    await recordTransactionCounters(ctx, {
      _id: primaryId,
      creditsId: credits._id,
      type: "reservation",
      creditType: "free",
      amount: -freeReserved,
      billingType: args.billingType,
      createdAt: now,
    });
  }

  if (paidReserved > 0) {
    const paidRowId = await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      userId: args.userId,
      type: "reservation",
      creditType: "paid",
      amount: -paidReserved,
      description,
      createdAt: now,
      // Link the paid sibling to the free primary when both pools are
      // used so `release` / `settle` can walk the group from one handle.
      ...(primaryId !== null ? { reservationOf: primaryId } : {}),
      ...scope,
    });
    await recordTransactionCounters(ctx, {
      _id: paidRowId,
      creditsId: credits._id,
      type: "reservation",
      creditType: "paid",
      amount: -paidReserved,
      billingType: args.billingType,
      createdAt: now,
    });
    if (primaryId === null) primaryId = paidRowId;
  }

  return {
    reservationId: primaryId,
    reserved: args.amount,
    remaining: balance.total - args.amount,
  };
}

/**
 * Resolve a caller-supplied handle to the full reservation group (primary
 * + any sibling rows). Tolerates being handed either the primary `_id` or
 * a sibling's `_id` — sibling rows point back to the primary via
 * `reservationOf`, so we normalize either way.
 */
async function loadReservationGroup(
  ctx: MutationCtx,
  handle: Id<"creditTransactions">,
): Promise<Doc<"creditTransactions">[]> {
  const entry = await ctx.db.get(handle);
  if (!entry || entry.type !== "reservation") {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Reservation not found",
    });
  }

  const primaryId = entry.reservationOf ?? handle;
  const primary =
    entry.reservationOf !== undefined ? await ctx.db.get(primaryId) : entry;

  if (!primary || primary.type !== "reservation") {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Reservation primary row not found",
    });
  }

  const siblings = await ctx.db
    .query("creditTransactions")
    .withIndex("by_reservationOf", (q) => q.eq("reservationOf", primaryId))
    .filter((q) => q.eq(q.field("type"), "reservation"))
    .collect();

  return [primary, ...siblings];
}

async function releaseExistsFor(
  ctx: MutationCtx,
  reservationRowId: Id<"creditTransactions">,
): Promise<boolean> {
  const release = await ctx.db
    .query("creditTransactions")
    .withIndex("by_reservationOf", (q) =>
      q.eq("reservationOf", reservationRowId),
    )
    .filter((q) => q.eq(q.field("type"), "reservation_release"))
    .first();
  return release !== null;
}

export type ReleaseReservationArgs = {
  reservationId: Id<"creditTransactions">;
  description?: string;
};

export type ReleaseReservationResult = {
  released: number;
};

/**
 * Cancel a reservation. Idempotent: probes each member row for an
 * existing `reservation_release` and only inserts an offset when none
 * exists. Returns the total credits returned to the wallet across all
 * member rows (0 if everything was already released).
 */
export async function releaseReservationTransaction(
  ctx: MutationCtx,
  args: ReleaseReservationArgs,
): Promise<ReleaseReservationResult> {
  const group = await loadReservationGroup(ctx, args.reservationId);
  const now = Date.now();
  const description = args.description ?? "Reservation released";

  let released = 0;

  for (const row of group) {
    if (await releaseExistsFor(ctx, row._id)) continue;

    const offsetAmount = -row.amount; // negative hold → positive offset
    const releaseId = await ctx.db.insert("creditTransactions", {
      creditsId: row.creditsId,
      userId: row.userId,
      type: "reservation_release",
      creditType: row.creditType,
      amount: offsetAmount,
      description,
      reservationOf: row._id,
      jobId: row.jobId,
      paperId: row.paperId,
      resultId: row.resultId,
      billingType: row.billingType,
      metadata: row.metadata,
      createdAt: now,
    });
    await recordTransactionCounters(ctx, {
      _id: releaseId,
      creditsId: row.creditsId,
      type: "reservation_release",
      creditType: row.creditType,
      amount: offsetAmount,
      billingType: row.billingType,
      createdAt: now,
    });

    released += offsetAmount;
  }

  return { released };
}

export type SettleReservationArgs = {
  reservationId: Id<"creditTransactions">;
  userId: Id<"users">;
  actualCost: number;
  description?: string;
  jobId?: Id<"extractionJobs">;
  paperId?: Id<"extractionPapers">;
  resultId?: Id<"extractionResults">;
  billingType?: Doc<"creditTransactions">["billingType"];
  metadata?: Record<string, string>;
  /**
   * When true (default), an actuals overrun against the post-release
   * wallet is absorbed by draining to zero rather than throwing
   * `INSUFFICIENT_CREDITS`. Mirrors `deductCreditsTransaction`'s
   * `allowPartial` semantics — the reservation was the pre-flight gate,
   * so any per-run overrun is small and intentionally absorbed.
   */
  allowPartial?: boolean;
};

export type SettleReservationResult = {
  released: number;
  usage: DeductCreditsResult;
};

/**
 * Settle a reservation against the true cost. Releases the hold (so the
 * credits return to the wallet via aggregate sums), then records the
 * actual usage via `deductCreditsTransaction` — free-first allocation
 * against the post-release balance. The combination is atomic within
 * one Convex mutation transaction.
 */
export async function settleReservationTransaction(
  ctx: MutationCtx,
  args: SettleReservationArgs,
): Promise<SettleReservationResult> {
  if (args.actualCost < 0) {
    throw new ConvexError({
      code: "INVALID_AMOUNT",
      message: "Actual cost must be non-negative",
    });
  }

  const release = await releaseReservationTransaction(ctx, {
    reservationId: args.reservationId,
    description: args.description
      ? `${args.description} (reservation settled)`
      : undefined,
  });

  if (args.actualCost === 0) {
    return {
      released: release.released,
      usage: { deducted: 0, remaining: 0 },
    };
  }

  const usage = await deductCreditsTransaction(ctx, {
    userId: args.userId,
    amount: args.actualCost,
    description: args.description,
    jobId: args.jobId,
    paperId: args.paperId,
    resultId: args.resultId,
    billingType: args.billingType,
    metadata: args.metadata,
    allowPartial: args.allowPartial ?? true,
  });

  return { released: release.released, usage };
}

export const reserveCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    description: v.optional(v.string()),
    jobId: v.optional(v.id("extractionJobs")),
    paperId: v.optional(v.id("extractionPapers")),
    resultId: v.optional(v.id("extractionResults")),
    billingType: v.optional(billingTypeValidator),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    reservationId: v.union(v.id("creditTransactions"), v.null()),
    reserved: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    return await reserveCreditsTransaction(ctx, args);
  },
});

export const releaseReservation = internalMutation({
  args: {
    reservationId: v.id("creditTransactions"),
    description: v.optional(v.string()),
  },
  returns: v.object({
    released: v.number(),
  }),
  handler: async (ctx, args) => {
    return await releaseReservationTransaction(ctx, args);
  },
});

export const settleReservation = internalMutation({
  args: {
    reservationId: v.id("creditTransactions"),
    userId: v.id("users"),
    actualCost: v.number(),
    description: v.optional(v.string()),
    jobId: v.optional(v.id("extractionJobs")),
    paperId: v.optional(v.id("extractionPapers")),
    resultId: v.optional(v.id("extractionResults")),
    billingType: v.optional(billingTypeValidator),
    metadata: v.optional(v.record(v.string(), v.string())),
    allowPartial: v.optional(v.boolean()),
  },
  returns: v.object({
    released: v.number(),
    usage: v.object({
      deducted: v.number(),
      remaining: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    return await settleReservationTransaction(ctx, args);
  },
});
