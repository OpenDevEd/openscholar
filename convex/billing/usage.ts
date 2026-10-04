import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, type QueryCtx } from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { usageKindValidator } from "./validators";
import { jobSpace, spendSpace, usageAgg, userSpace } from "./usageLog";
import { insertUsage } from "./ledger";
import { availableCredits } from "./accounts";

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
    // Only refund rows name a Stripe charge. Each is keyed refund:<charge>:<refunded cents>
    // and written only for more cents than the last, so the newest holds the most.
    const latest = await ctx.db
      .query("billingUsage")
      .withIndex("by_stripe_charge", (q) => q.eq("stripeChargeId", args.stripeChargeId))
      .order("desc")
      .first();
    const previousCents = (latest && Number(latest.chargeId.split(":").at(-1))) || 0;
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

/** The charges a count or a page is of: a job's, when it's the person's, or all of theirs. */
async function chargesOf(ctx: QueryCtx, userId: Id<"users">, jobId: Id<"extractionJobs"> | undefined) {
  if (!jobId) return { namespace: userSpace(userId), rows: ctx.db.query("billingUsage").withIndex("by_user_and_createdAt", (q) => q.eq("userId", userId)) };
  if ((await ctx.db.get("extractionJobs", jobId))?.userId !== userId) return null;
  return { namespace: jobSpace(jobId), rows: ctx.db.query("billingUsage").withIndex("by_job_and_createdAt", (q) => q.eq("jobId", jobId)) };
}

export const listChargesAction = defineUserQuery({
  path: "billing/usage:listCharges",
  description: "Lists the person's credit charges, newest first, a page at a time. Given `jobId`, only that extraction job's charges.",
  args: { paginationOpts: paginationOptsValidator, jobId: v.optional(v.id("extractionJobs")) },
  returns: paginationResultValidator(usageRowValidator),
  run: async (ctx, userId, { paginationOpts, jobId }) => {
    const charges = await chargesOf(ctx, userId, jobId);
    if (!charges) return { page: [], isDone: true, continueCursor: "" };
    const read = await charges.rows.order("desc").paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, MAX_PAGE_SIZE) });
    return { ...read, page: read.page.map(({ _id, credits, kind, description, jobId, model, createdAt }) => ({ _id, credits, kind, description, jobId, model, createdAt })) };
  },
});
export const listCharges = userQuery(listChargesAction);
export const listChargesForAssistant = assistantQuery(listChargesAction);

export const countChargesAction = defineUserQuery({
  path: "billing/usage:countCharges",
  description: "Says how many credit charges the person has. Given `jobId`, how many that extraction job has.",
  args: { jobId: v.optional(v.id("extractionJobs")) },
  returns: v.number(),
  run: async (ctx, userId, { jobId }) => {
    const charges = await chargesOf(ctx, userId, jobId);
    // The ledger worker counts a charge a moment after it's recorded (./usageLog.ts).
    return charges ? await usageAgg.count(ctx, { namespace: charges.namespace, stale: true }) : 0;
  },
});
export const countCharges = userQuery(countChargesAction);
export const countChargesForAssistant = assistantQuery(countChargesAction);

const DAY = 86_400_000;
const CHART_KINDS = usageKindValidator.members.map((m) => m.value).filter((kind) => kind !== "refund");

/** The longest span the spending chart totals. */
const MAX_SPENDING_DAYS = 90;
const spendingCellValidator = v.object({ day: v.number(), kind: usageKindValidator, credits: v.number() });

/** Credits `userId` spent per day and kind over `days` days from `since`, oldest day first; days with none are left out. */
async function spendingOf(ctx: QueryCtx, userId: Id<"users">, since: number, days: number) {
  const span = Math.min(Math.max(1, Math.floor(days)), MAX_SPENDING_DAYS);
  const cells = CHART_KINDS.flatMap((kind) => Array.from({ length: span }, (_, day) => ({ kind, day })));
  const sums = await usageAgg.sumBatch(
    ctx,
    cells.map(({ kind, day }) => ({
      namespace: spendSpace(userId, kind),
      bounds: {
        lower: { key: since + day * DAY, inclusive: true },
        // The last day runs to now, so today's charges always count.
        ...(day < span - 1 ? { upper: { key: since + (day + 1) * DAY, inclusive: false } } : {}),
      },
    })),
    { stale: true },
  );
  return cells.map((cell, i) => ({ ...cell, credits: sums[i]! })).filter((cell) => cell.credits > 0);
}

export const balanceAction = defineUserQuery({
  path: "billing/usage:balance",
  description:
    "Says how many credits the person has to spend now. A reply the assistant is writing holds some until it ends, so while one is, this is lower than their balance by what that reply holds.",
  args: {},
  returns: v.object({ credits: v.number() }),
  run: async (ctx, userId) => ({ credits: await availableCredits(ctx, userId) }),
});
export const balance = userQuery(balanceAction);
export const balanceForAssistant = assistantQuery(balanceAction);

export const spendingAction = defineUserQuery({
  path: "billing/usage:spending",
  description:
    `Totals the credits the person spent per day and kind of work, for up to ${MAX_SPENDING_DAYS} days from the time \`since\` (in milliseconds), as one page. ` +
    "`day` counts days from `since`; a day and kind with nothing spent is left out, and refunds aren't counted.",
  args: { since: v.number(), days: v.number() },
  returns: paginationResultValidator(spendingCellValidator),
  run: async (ctx, userId, { since, days }) => ({ page: await spendingOf(ctx, userId, since, days), isDone: true, continueCursor: "" }),
});
export const spending = userQuery(spendingAction);
export const spendingForAssistant = assistantQuery(spendingAction);

