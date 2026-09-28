import { v, type Infer } from "convex/values";

export const planIdValidator = v.union(v.literal("free"), v.literal("go"), v.literal("pro"));
export const paidPlanIdValidator = v.union(v.literal("go"), v.literal("pro"));

export const billingAccountSnapshotValidator = v.object({
  plan: planIdValidator,
  pastDue: v.boolean(),
  /** Set while a paid plan renews at the end of its period. */
  renewsAt: v.optional(v.number()),
  /** Set when the current plan ends at its period end. */
  changesAt: v.optional(v.number()),
  /** The plan that starts at `changesAt`. */
  nextPlan: v.optional(planIdValidator),
  balance: v.number(),
  /** Top-up credits, which never expire; included in `balance`. */
  purchased: v.number(),
  card: v.optional(v.object({ brand: v.string(), last4: v.string() })),
  signupGranted: v.boolean(),
  /** Has paid for a plan or credits, so Stripe holds invoices for them. */
  hasPaid: v.boolean(),
  stripeCustomerId: v.optional(v.string()),
});
export type BillingAccountSnapshot = Infer<typeof billingAccountSnapshotValidator>;

export const billingAccountFields = {
  ...billingAccountSnapshotValidator.fields,
  userId: v.id("users"),
  refreshedAt: v.number(),
};

export const usageKindValidator = v.union(
  v.literal("chat"),
  v.literal("extraction"),
  v.literal("screening"),
  v.literal("search"),
  v.literal("translation"),
  v.literal("wallet_api"),
  v.literal("refund"),
);
export type UsageKind = Infer<typeof usageKindValidator>;

export const billingUsageFields = {
  userId: v.id("users"),
  /** The Autumn lock or idempotency key this charge settled. */
  chargeId: v.string(),
  credits: v.number(),
  kind: usageKindValidator,
  description: v.string(),
  jobId: v.optional(v.id("extractionJobs")),
  model: v.optional(v.string()),
  costUsd: v.optional(v.number()),
  /** Set on refund reversals. */
  stripeChargeId: v.optional(v.string()),
  createdAt: v.number(),
};
