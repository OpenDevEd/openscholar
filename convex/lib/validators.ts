import { v, type Infer, type Validator } from "convex/values";
import type { Doc, TableNames } from "../_generated/dataModel";

/**
 * Compile-time invariant: the runtime row type for `T` is exactly the
 * `Infer<>` shape of the mirror validator `V`. Drift in either direction
 * collapses this type to a string literal that fails to assign to `true`,
 * surfacing the bug under `tsc --noEmit`.
 *
 * Used as:
 *   const _check_xValidator: AssertExactDoc<"x", typeof xValidator> = true;
 *
 * Place the `_check_` line directly under each mirror validator — it is
 * the structural contract.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AssertExactDoc<T extends TableNames, V extends Validator<any, any, any>> =
  [Doc<T>] extends [Infer<V>]
    ? [Infer<V>] extends [Doc<T>]
      ? true
      : "validator has fields the table does not (validator is wider)"
    : "table has fields the validator does not (validator is narrower)";

export const planValidator = v.union(
  v.literal("free"),
  v.literal("go"),
  v.literal("pro"),
  v.literal("enterprise")
);
export type PlanType = "free" | "go" | "pro" | "enterprise";

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("trialing"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused")
);
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export const userStateValidator = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("deleted")
);

export const creditTransactionTypeValidator = v.union(
  v.literal("purchase"),
  v.literal("usage"),
  v.literal("grant"),
  v.literal("refund"),
  v.literal("expiry"),
  // Tier D: append-only reservation primitive. `reservation` rows carry a
  // negative `amount` summand that drops the aggregated balance, holding
  // credits against an in-flight estimate. `reservation_release` rows
  // carry a positive offsetting summand keyed to the same scope, settling
  // or cancelling the reservation. Both shapes are pure inserts — no
  // credits row mutation — so concurrent reservations across fan-out
  // never OCC-contend on a shared cell.
  v.literal("reservation"),
  v.literal("reservation_release")
);

export const apiKeyProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("openrouter")
);

export const userFields = {
  clerkId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  state: userStateValidator,
  lastLoginAt: v.optional(v.number()),
  libraryItemCount: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  ...userFields,
});

const _check_userValidator: AssertExactDoc<"users", typeof userValidator> = true;
void _check_userValidator;

// The credits row is a pure anchor — a per-user pointer that gives the
// balance sharded counters a stable key. Balances (`free`, `paid`) are
// the live counts of `balanceFreeCounter` / `balancePaidCounter` (see
// `convex/credits/balanceCounter.ts`), each updated by signed deltas in
// `recordTransactionCounters` when a `creditTransactions` row inserts.
// Schema kept minimal on purpose — anything that previously read
// `credits.{freeBalance|paidBalance|lifetimeUsed}` now calls `readBalance`.
export const creditsFields = {
  userId: v.id("users"),
  createdAt: v.number(),
};

export const creditsValidator = v.object({
  _id: v.id("credits"),
  _creationTime: v.number(),
  ...creditsFields,
});

const _check_creditsValidator: AssertExactDoc<"credits", typeof creditsValidator> = true;
void _check_creditsValidator;

export const creditBalanceValidator = v.object({
  free: v.number(),
  paid: v.number(),
  total: v.number(),
});

export const subscriptionFields = {
  userId: v.id("users"),
  stripeSubscriptionId: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),
  plan: planValidator,
  status: subscriptionStatusValidator,
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
  cancelAtPeriodEnd: v.optional(v.boolean()),
  canceledAt: v.optional(v.number()),
  pastDueSince: v.optional(v.number()),
  creditsPerMonth: v.optional(v.number()),
  seats: v.optional(v.number()),
  pendingFromPlan: v.optional(planValidator),
  pendingToPlan: v.optional(planValidator),
  pendingChangeTimestamp: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const subscriptionValidator = v.object({
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
  ...subscriptionFields,
});

const _check_subscriptionValidator: AssertExactDoc<"subscriptions", typeof subscriptionValidator> = true;
void _check_subscriptionValidator;

export const billingTypeValidator = v.union(
  v.literal("extraction_llm"),
  v.literal("embedding"),
  v.literal("screening"),
  v.literal("chat"),
  v.literal("search"),
  v.literal("translation"),
  v.literal("wallet_api"),
);

export const creditTransactionFields = {
  creditsId: v.id("credits"),
  userId: v.optional(v.id("users")),
  type: creditTransactionTypeValidator,
  creditType: v.union(v.literal("free"), v.literal("paid")),
  // Tier D: `amount` is a SIGNED ledger entry — positive for grants /
  // purchases / refund-in / reservation_release, negative for usage /
  // refund-out / reservation. The aggregate sums these to produce the
  // current balance, so no `balanceAfter` snapshot is recorded (it would
  // be stale the instant a concurrent insert lands).
  amount: v.number(),
  description: v.optional(v.string()),
  // Tier D: links a `reservation_release` back to the originating
  // `reservation` row. The pre-flight reservation primitive uses this to
  // identify and offset its hold once the actual cost is known.
  reservationOf: v.optional(v.id("creditTransactions")),
  // Plan-04 first-class scoping columns. Present on all usage rows
  // created after the plan-04 schema refactor; optional on legacy rows.
  jobId: v.optional(v.id("extractionJobs")),
  paperId: v.optional(v.id("extractionPapers")),
  resultId: v.optional(v.id("extractionResults")),
  billingType: v.optional(billingTypeValidator),
  metadata: v.optional(v.record(v.string(), v.string())),
  stripeInvoiceId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  stripeCheckoutSessionId: v.optional(v.string()),
  createdAt: v.number(),
  // billing-txn-perf plan-02: precomputed search string for the
  // `search_transactions` searchIndex.
  searchableText: v.optional(v.string()),
};

export const creditTransactionValidator = v.object({
  _id: v.id("creditTransactions"),
  _creationTime: v.number(),
  ...creditTransactionFields,
});

const _check_creditTransactionValidator: AssertExactDoc<
  "creditTransactions",
  typeof creditTransactionValidator
> = true;
void _check_creditTransactionValidator;

export const chatPaperFields = {
  jobId: v.id("extractionJobs"),
  sourceId: v.id("extractionJobSources"),
  included: v.boolean(),
};

export const chatPaperValidator = v.object({
  _id: v.id("chatPapers"),
  _creationTime: v.number(),
  ...chatPaperFields,
});

const _check_chatPaperValidator: AssertExactDoc<
  "chatPapers",
  typeof chatPaperValidator
> = true;
void _check_chatPaperValidator;

export const chatGenerationUsageSourceValidator = v.union(
  v.literal("openrouter_response_id"),
  v.literal("sdk_usage"),
  v.literal("openrouter_generation_api"),
);

export const chatGenerationUsageStatusValidator = v.union(
  v.literal("captured"),
  v.literal("retrying"),
  v.literal("billed"),
  v.literal("failed"),
);

export const chatGenerationUsageFields = {
  generationId: v.string(),
  jobId: v.id("extractionJobs"),
  threadId: v.string(),
  userId: v.id("users"),
  requestedModel: v.optional(v.string()),
  authoritativeModel: v.optional(v.string()),
  providerName: v.optional(v.string()),
  source: chatGenerationUsageSourceValidator,
  status: chatGenerationUsageStatusValidator,
  cancelled: v.optional(v.boolean()),
  finishReason: v.optional(v.string()),
  nativeFinishReason: v.optional(v.string()),
  promptTokens: v.optional(v.number()),
  completionTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
  cachedPromptTokens: v.optional(v.number()),
  totalCostUsd: v.optional(v.number()),
  billedCredits: v.optional(v.number()),
  attemptCount: v.number(),
  lastAttemptAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),
  authoritativeAt: v.optional(v.number()),
  billedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const chatGenerationUsageValidator = v.object({
  _id: v.id("chatGenerationUsages"),
  _creationTime: v.number(),
  ...chatGenerationUsageFields,
});

const _check_chatGenerationUsageValidator: AssertExactDoc<
  "chatGenerationUsages",
  typeof chatGenerationUsageValidator
> = true;
void _check_chatGenerationUsageValidator;
