import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query } from "../_generated/server";
import { getCurrentUser } from "../lib/auth";
import { usageKindValidator } from "./validators";

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
    await ctx.db.insert("billingUsage", {
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

/** The user's charges, newest first, optionally only those for one of their jobs. */
export const listMine = query({
  args: { paginationOpts: paginationOptsValidator, jobId: v.optional(v.id("extractionJobs")) },
  returns: v.object({
    page: v.array(usageRowValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts, jobId }) => {
    const user = await getCurrentUser(ctx);
    const empty = { page: [], isDone: true, continueCursor: "" };
    if (!user) return empty;
    if (jobId && (await ctx.db.get("extractionJobs", jobId))?.userId !== user._id) return empty;
    const rows = jobId
      ? ctx.db.query("billingUsage").withIndex("by_job", (q) => q.eq("jobId", jobId))
      : ctx.db
          .query("billingUsage")
          .withIndex("by_user_and_createdAt", (q) => q.eq("userId", user._id));
    const result = await rows.order("desc").paginate(paginationOpts);
    return {
      page: result.page.map(({ _id, credits, kind, description, jobId, model, createdAt }) => ({
        _id,
        credits,
        kind,
        description,
        jobId,
        model,
        createdAt,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
