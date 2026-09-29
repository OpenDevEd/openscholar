import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser } from "../lib/auth";
import { usageKindValidator } from "./validators";
import { insertUsage, jobSpace, spendSpace, usageAgg, userSpace } from "./usageLog";

/**
 * Claims a Stripe charge's refunded total for reversal, one caller at a time.
 * Returns the total an earlier call already claimed, or null when this total
 * is already claimed. The row's credits are filled in once they're removed.
 */
export const claimRefund = internalMutation({
  args: {
    userId: v.id("users"),
    stripeChargeId: v.string(),
    refundedCents: v.number(),
    description: v.string(),
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("billingUsage")
      .withIndex("by_stripe_charge", (q) => q.eq("stripeChargeId", args.stripeChargeId))
      .collect();
    // Refund rows are keyed refund:<charge>:<refunded cents>.
    const previousCents = Math.max(0, ...rows.map((row) => Number(row.chargeId.split(":").at(-1)) || 0));
    if (args.refundedCents <= previousCents) return null;
    await insertUsage(ctx, {
      userId: args.userId,
      chargeId: `refund:${args.stripeChargeId}:${args.refundedCents}`,
      credits: 0,
      kind: "refund",
      description: args.description,
      stripeChargeId: args.stripeChargeId,
      createdAt: Date.now(),
    });
    return previousCents;
  },
});

export const setRefundCredits = internalMutation({
  args: { chargeId: v.string(), credits: v.number() },
  returns: v.null(),
  handler: async (ctx, { chargeId, credits }) => {
    const row = await ctx.db
      .query("billingUsage")
      .withIndex("by_charge", (q) => q.eq("chargeId", chargeId))
      .unique();
    if (row) await ctx.db.patch("billingUsage", row._id, { credits });
    return null;
  },
});

const usageRowValidator = v.object({
  _id: v.id("billingUsage"),
  credits: v.number(),
  kind: usageKindValidator,
  description: v.string(),
  jobId: v.optional(v.id("extractionJobs")),
  model: v.optional(v.string()),
  createdAt: v.number(),
});

/** How many charges a page shows at most. */
const MAX_PAGE_SIZE = 50;

/**
 * One page of the user's charges, newest first, with the total for page
 * numbers. With `jobId`, only that job's charges (the job must be theirs).
 */
export const pageMine = query({
  args: { page: v.number(), pageSize: v.number(), jobId: v.optional(v.id("extractionJobs")) },
  returns: v.object({ total: v.number(), rows: v.array(usageRowValidator) }),
  handler: async (ctx, { page, pageSize, jobId }) => {
    const user = await getCurrentUser(ctx);
    const empty = { total: 0, rows: [] };
    if (!user) return empty;
    if (jobId && (await ctx.db.get("extractionJobs", jobId))?.userId !== user._id) return empty;
    const namespace = jobId ? jobSpace(jobId) : userSpace(user._id);
    const total = await usageAgg.count(ctx, { namespace });
    const size = Math.min(Math.max(1, Math.floor(pageSize)), MAX_PAGE_SIZE);
    const lastPage = Math.max(1, Math.ceil(total / size));
    const start = (Math.min(Math.max(1, Math.floor(page)), lastPage) - 1) * size;
    const end = Math.min(start + size, total);
    if (start >= end) return { total, rows: [] };
    // Offsets count from the newest charge: -1 is the latest.
    const items = await usageAgg.atBatch(
      ctx,
      Array.from({ length: end - start }, (_, i) => ({ namespace, offset: -(start + i) - 1 })),
    );
    const rows = [];
    for (const item of items) {
      const row = await ctx.db.get("billingUsage", item.id as Id<"billingUsage">);
      if (row) {
        const { _id, credits, kind, description, jobId, model, createdAt } = row;
        rows.push({ _id, credits, kind, description, jobId, model, createdAt });
      }
    }
    return { total, rows };
  },
});

const DAY = 86_400_000;
const CHART_KINDS = usageKindValidator.members.map((m) => m.value).filter((kind) => kind !== "refund");

/** Credits spent per day and kind over the last `days` days, oldest day first. */
export const spendingMine = query({
  args: { since: v.number(), days: v.number() },
  returns: v.array(v.object({ day: v.number(), kind: usageKindValidator, credits: v.number() })),
  handler: async (ctx, { since, days }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const span = Math.min(Math.max(1, Math.floor(days)), 90);
    const cells = CHART_KINDS.flatMap((kind) => Array.from({ length: span }, (_, day) => ({ kind, day })));
    const sums = await usageAgg.sumBatch(
      ctx,
      cells.map(({ kind, day }) => ({
        namespace: spendSpace(user._id, kind),
        bounds: {
          lower: { key: since + day * DAY, inclusive: true },
          // The last day runs to now, so today's charges always count.
          ...(day < span - 1 ? { upper: { key: since + (day + 1) * DAY, inclusive: false } } : {}),
        },
      })),
    );
    return cells.map((cell, i) => ({ ...cell, credits: sums[i]! })).filter((cell) => cell.credits > 0);
  },
});
