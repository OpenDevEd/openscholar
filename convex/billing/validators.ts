import { v, type Infer } from "convex/values";
import { MAX_BILLING_FEATURES, MAX_BILLING_PLANS, MAX_PLAN_DETAILS, capped } from "../lib/listCaps";

export const billingAccountSnapshotValidator = v.object({
  /** The customer's main plan id in Autumn; absent if they have none. */
  plan: v.optional(v.string()),
  pastDue: v.boolean(),
  /** When the paid plan's current billing period started. */
  periodStart: v.optional(v.number()),
  /** Set while a paid plan renews at the end of its period. */
  renewsAt: v.optional(v.number()),
  /** Set when the current plan ends at its period end. */
  changesAt: v.optional(v.number()),
  /** The plan that starts at `changesAt`. */
  nextPlan: v.optional(v.string()),
  /**
   * Boolean features the customer's plans grant, such as "extraction".
   * Absent on snapshots cached before plan features existed; every refresh
   * writes it.
   */
  features: capped(v.optional(v.array(v.string())), MAX_BILLING_FEATURES),
  balance: v.number(),
  /**
   * Papers the person may have running at once (#335), from the plan's `concurrency`
   * balance in Autumn, as Firecrawl reads its `CONCURRENCY`. Absent when the plan sets none.
   */
  concurrency: v.optional(v.number()),
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
  /** Set while a refresh from Autumn is scheduled, so charges don't schedule more. */
  refreshQueuedAt: v.optional(v.number()),
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
  /** Input tokens served from the provider's prompt cache. */
  cacheReadTokens: v.optional(v.number()),
  /** Input tokens written to the prompt cache. */
  cacheWriteTokens: v.optional(v.number()),
  /** Output tokens spent reasoning. */
  reasoningTokens: v.optional(v.number()),
  /** Set on refund reversals. */
  stripeChargeId: v.optional(v.string()),
  /** The hold of the approved job this was spent under (./charge.ts): Autumn was charged for it with that hold's one confirm, not by itself, which is what reconciling the ledger with Autumn needs to know. */
  under: v.optional(v.string()),
  createdAt: v.number(),
};

/**
 * A plan from Autumn's catalog, reduced to what the app shows and checks.
 * Metadata set on the plan in Autumn's dashboard fills the optional fields.
 */
export const catalogPlanValidator = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  /** Main plans share a group; add-ons (signup credits, top-ups) have none. */
  group: v.optional(v.string()),
  addOn: v.boolean(),
  /** Given to every new customer: the Free plan. */
  autoEnable: v.boolean(),
  price: v.optional(v.object({ amount: v.number(), interval: v.string() })),
  /** The plan's credits, if any. */
  credits: v.optional(
    v.object({
      included: v.number(),
      /** How often they refill: "month", "year", "one_off", ... */
      interval: v.string(),
      rolloverMax: v.optional(v.number()),
      /** Set when credits are bought: `amount` buys `billingUnits` credits. */
      unitPrice: v.optional(v.object({ amount: v.number(), billingUnits: v.number() })),
    }),
  ),
  /** Boolean features the plan grants, such as "extraction". */
  features: capped(v.array(v.string()), MAX_PLAN_DETAILS),
  /** Metadata `popular: true` marks the plan as the one to recommend. */
  popular: v.boolean(),
  /** Metadata `highlights`: extra lines for the pricing card. */
  highlights: capped(v.optional(v.array(v.string())), MAX_PLAN_DETAILS),
  /** Metadata `bundles` on the top-up plan: the credit amounts offered. */
  bundles: capped(v.optional(v.array(v.number())), MAX_PLAN_DETAILS),
});
export type CatalogPlan = Infer<typeof catalogPlanValidator>;

export const catalogFeatureValidator = v.object({
  id: v.string(),
  name: v.string(),
  type: v.string(),
});
export type CatalogFeature = Infer<typeof catalogFeatureValidator>;

export const billingCatalogValidator = v.object({
  plans: capped(v.array(catalogPlanValidator), MAX_BILLING_PLANS),
  features: capped(v.array(catalogFeatureValidator), MAX_BILLING_FEATURES),
});
export type BillingCatalog = Infer<typeof billingCatalogValidator>;

/** The lines of a plan change's first charge, as Autumn previews it: at most MAX_PLAN_DETAILS are shown. */
export const previewLineItemsValidator = capped(v.array(v.object({ description: v.string(), amount: v.number() })), MAX_PLAN_DETAILS);
