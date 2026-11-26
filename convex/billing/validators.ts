import { v, type Infer } from "convex/values";
import { REFILL_INTERVALS } from "../../lib/billing/plans";
import { MAX_BILLING_FEATURES, MAX_BILLING_PLANS, MAX_PLAN_DETAILS, capped } from "../lib/listCaps";

/** A plan's limit on each of lib/billing/plans.ts PLAN_LIMITS it sets: a number, or null for unlimited. A limit left out isn't set. */
const limitValue = v.optional(v.union(v.number(), v.null()));
export const planLimitsValidator = v.object({ collections: limitValue, concurrency: limitValue, assistant_replies: limitValue, request_papers: limitValue, bulk_papers: limitValue, uploads_per_hour: limitValue, guests: limitValue, suggestions_per_day: limitValue, overviews_per_day: limitValue, reports_per_day: limitValue, screening_models: limitValue });

/** How often a balance refills (lib/billing/plans.ts REFILL_INTERVALS). */
export const refillValidator = v.union(...REFILL_INTERVALS.map((interval) => v.literal(interval)));

/**
 * One part of a workspace's publication balance, in US dollars: what refills by `interval`, back to `refillsTo` on
 * `resetsAt` (`size` once every grant of it has refilled), or with `once` what stays until used (given once, or
 * bought). `left` is what remains of it now.
 */
export const balancePartValidator = v.object({ interval: v.union(refillValidator, v.literal("once")), left: v.number(), size: v.number(), resetsAt: v.optional(v.number()), refillsTo: v.optional(v.number()) });
export type BalancePart = Infer<typeof balancePartValidator>;
/** At most one part of each kind: every interval, and `once`. */
export const PUBLICATION_PARTS_MAX = REFILL_INTERVALS.length + 1;
export const balancePartsValidator = capped(v.array(balancePartValidator), PUBLICATION_PARTS_MAX);

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
  /** What the customer's plans allow, from their balances in Autumn (#632); absent on a snapshot cached before limits existed. */
  limits: v.optional(planLimitsValidator),
  /** Top-up credits, which never expire; included in `balance`. */
  purchased: v.number(),
  /**
   * The customer's publication balance by part, refilling ones first, shortest interval first, as Autumn spends them;
   * absent with nothing in it. Wrapped whole, as `v.optional` copies the validator it's given.
   */
  publication: capped(v.optional(v.array(balancePartValidator)), PUBLICATION_PARTS_MAX),
  /** The publication balance has no limit: every report is paid from it. */
  publicationUnlimited: v.optional(v.boolean()),
  card: v.optional(v.object({ brand: v.string(), last4: v.string() })),
  /** Credit on the customer's Stripe balance, in US dollars, which Stripe takes a charge from before the card: read with `card`. */
  credit: v.optional(v.number()),
  /** The currency of the customer at Stripe when it isn't US dollars, upper case: nothing priced in dollars can be bought there, and its credit isn't counted. Read with `card`. */
  stripeCurrency: v.optional(v.string()),
  signupGranted: v.boolean(),
  /** Has paid for a plan or credits, so Stripe holds invoices for them. */
  hasPaid: v.boolean(),
  /** Has really paid: `hasPaid` also holds on the free organization plan and on a trial. Absent on a snapshot cached before this. */
  paying: v.optional(v.boolean()),
  stripeCustomerId: v.optional(v.string()),
  /** While past due, the payment that failed (#40): how much, when its invoice was raised, and the page that pays it. */
  unpaid: v.optional(v.object({ amount: v.number(), currency: v.string(), since: v.number(), url: v.optional(v.string()) })),
});
export type BillingAccountSnapshot = Infer<typeof billingAccountSnapshotValidator>;

export const billingAccountFields = {
  ...billingAccountSnapshotValidator.fields,
  // From before the publication balance, when a report's activation was counted: cleared by migrations/publicationBalance, then dropped.
  activations: v.optional(v.union(v.number(), v.null())),
  activationsRefill: v.optional(refillValidator),
  /** The workspace whose Autumn customer it caches (#650). */
  workspaceId: v.id("workspaces"),
  /** When it was first seen paying, so a return after cancelling isn't a first payment again. */
  firstPaidAt: v.optional(v.number()),
  refreshedAt: v.number(),
  /** When the snapshot was read from Autumn: a refresh read before it is older, and is dropped. Unlike `refreshedAt`, zeroing the balance leaves it. */
  fetchedAt: v.optional(v.number()),
  /** When the cached publication balance was read from Autumn: a read made while a report is being paid for keeps the one before it, so this can be older than `fetchedAt`. */
  publicationAt: v.optional(v.number()),
  /** When the cached `card` was read from Autumn: an older refresh that read the card still brings a newer one than this. */
  cardFetchedAt: v.optional(v.number()),
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
  /** Who spent it. */
  userId: v.id("users"),
  /** The workspace that paid (#650); absent on a charge of an account purged before workspaces, which left none. */
  workspaceId: v.optional(v.id("workspaces")),
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
  /** What the plan allows (#632). */
  limits: v.optional(planLimitsValidator),
  /** Metadata `popular: true` marks the plan as the one to recommend. */
  popular: v.boolean(),
  /** Listed but not sold: people ask for it, and it's added to them in Autumn. */
  byRequest: v.optional(v.literal(true)),
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
