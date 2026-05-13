# Plan 03 — Migrate remaining `convex/lib/validators.ts` mirrors

## Goal

Propagate the SSOT field-object pattern from plan 02 to the remaining three mirrors in `convex/lib/validators.ts`: `credits`, `subscriptions`, `creditTransactions`. Fold the plan 01 `searchableText` hotfix into the field-object so the patch is structural, not a separate one-line addition. One commit per table.

## Scope

- Two files only:
  - `convex/lib/validators.ts` — add `creditsFields`, `subscriptionFields`, `creditTransactionFields`; rewrite each `xValidator` to spread the field-object; add the `_check_xValidator` guard under each.
  - `convex/schema.ts` — change `credits: defineTable({...})`, `subscriptions: defineTable({...})`, `creditTransactions: defineTable({...})` to `defineTable(xFields)`; import the three field-objects from `./lib/validators`.
- Out of scope: extraction validators (plans 04/05), chat/screening backfill (plan 06), parity test (plan 07).

## Design

### Commit 1: `credits`

```ts
// convex/lib/validators.ts
export const creditsFields = {
  userId: v.id("users"),
  freeBalance: v.number(),
  paidBalance: v.number(),
  lifetimeUsed: v.number(),
  lastUpdatedAt: v.number(),
};

export const creditsValidator = v.object({
  _id: v.id("credits"),
  _creationTime: v.number(),
  ...creditsFields,
});

const _check_creditsValidator: AssertExactDoc<"credits", typeof creditsValidator> = true;
```

```ts
// convex/schema.ts
import { creditsFields } from "./lib/validators";

credits: defineTable(creditsFields).index("by_user", ["userId"]),
```

### Commit 2: `subscriptions`

The `subscriptions` table has inline `v.union` for `plan` and `status`. The existing `planValidator` and `subscriptionStatusValidator` already exist in `convex/lib/validators.ts` (lines 3 and 11). Use them in the field-object:

```ts
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
```

The schema currently inlines the `v.union(...)` for `plan` and `status` — this commit also de-duplicates the schema-side union by importing `planValidator` and `subscriptionStatusValidator`. The two unions become one declaration.

```ts
// convex/schema.ts
import { subscriptionFields } from "./lib/validators";

subscriptions: defineTable(subscriptionFields)
  .index("by_user", ["userId"])
  .index("by_stripe_sub", ["stripeSubscriptionId"])
  .index("by_stripe_customer", ["stripeCustomerId"])
  .index("by_status", ["status"])
  .index("by_status_updatedAt", ["status", "updatedAt"]),
```

### Commit 3: `creditTransactions` (folds plan 01)

```ts
// reuse the existing `billingTypeValidator` if exported; otherwise lift the inline
// union from `creditTransactionValidator` into a named export above and re-use.
// Plan-04 promoted these to first-class columns; keep them as a single declaration.

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
  amount: v.number(),
  balanceAfter: v.number(),
  description: v.optional(v.string()),
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

const _check_creditTransactionValidator: AssertExactDoc<"creditTransactions", typeof creditTransactionValidator> = true;
```

Schema-side: replace the inline `v.union(...)` for `billingType` with the new `billingTypeValidator` import, and replace `creditTransactions: defineTable({...})` with `defineTable(creditTransactionFields)`. The seven `.index(...)` and one `.searchIndex(...)` calls are preserved verbatim.

```ts
// convex/schema.ts
import { creditTransactionFields, billingTypeValidator } from "./lib/validators";

creditTransactions: defineTable(creditTransactionFields)
  .index("by_credits", ["creditsId"])
  // …all existing indexes…
  .searchIndex("search_transactions", {
    searchField: "searchableText",
    filterFields: ["creditsId", "type", "billingType", "creditType"],
  }),
```

**Note**: if plan 01 has not yet landed, this commit subsumes it — `searchableText` is added to the validator as part of the field-object. The hotfix test from plan 01 still applies and stays green.

## TDD sequence

Each commit runs the same drift-attempt → revert → confirm pattern (lifted from plan 02), proving the type guard fires before the green migration lands.

1. **Commit 1 (credits)**:
   - R: in `convex/lib/validators.ts`, temporarily omit `lifetimeUsed` from `creditsFields` while keeping it in the schema. `npx tsc --noEmit` errors with the validator-narrower message on `_check_creditsValidator`. Restore `lifetimeUsed`.
   - G: with the field restored, `tsc --noEmit` is clean.
   - Test: existing `convex/credits/aggregates.test.ts` and any `credits/queries.test.ts` test runs green — runtime shape is identical.

2. **Commit 2 (subscriptions)**:
   - R: omit `seats` from `subscriptionFields`. `tsc` errors. Restore.
   - G: `tsc` clean.
   - Test: `convex/subscriptions/queries.test.ts` (or equivalent) green.

3. **Commit 3 (creditTransactions, folds plan 01)**:
   - R: omit `searchableText` from `creditTransactionFields` while leaving it in the schema. `tsc` errors with validator-narrower. Restore.
   - G: `tsc` clean.
   - Test: the plan 01 vitest test (or a new one in this commit if plan 01 landed independently) asserts `getTransactions` preserves `searchableText`. Green.

## Files touched

- `convex/lib/validators.ts:1-137` — add three field-objects, three `_check_` guards, lift the inline `billingType` union into a named `billingTypeValidator` export.
- `convex/schema.ts:114-195` — replace three `defineTable({...})` arguments with field-object references.
- `convex/credits/queries.test.ts` — the plan 01 test stays here (or is added in commit 3 if plan 01 didn't land).

## Migration stance

Pure refactor (commits 1, 2) + folded plan 01 (commit 3 widens the validator to include `searchableText`).

- **Commit 1, 2**: no row-shape change, no dev DB action.
- **Commit 3**: validator widens by one optional field; schema unchanged. The Convex push must show `✔ Convex functions ready!` without any schema-rejection. If it complains the field-object differs from the prior inline shape, the migration was not byte-identical — fix the diff, do not paper over.

## Test plan

- `npx tsc --noEmit` after each commit — clean.
- `npx vitest run convex/credits convex/subscriptions convex/lib` — green.
- Manual drift test (R-step above) performed once and reverted before each green commit.

## Deployability gate

After EACH of the three commits:

- `npx pm2 logs convex --lines 5 --nostream` — `✔ Convex functions ready!`.
- No `✖ Error` line. No `Schema validator complaint` line.
- After commit 3, run `npx convex run credits:queries:getTransactions '{}'` against a seeded dev user (or via the convex MCP `run` tool) and confirm a returned row carries `searchableText` if any is populated.

## Acceptance criteria

- `creditsFields`, `subscriptionFields`, `creditTransactionFields`, `billingTypeValidator` exported from `convex/lib/validators.ts`.
- `convex/schema.ts` imports and uses all three field-objects via `defineTable(xFields)`.
- Three `_check_xValidator: AssertExactDoc<...> = true;` guards present, one under each mirror validator.
- `npx tsc --noEmit` clean after each commit.
- pm2 deployability gate green after each commit.
- All existing `convex/credits`, `convex/subscriptions`, `convex/lib` tests green.
- The plan 01 `searchableText` regression test stays green.

## Known pitfalls

- **`subscriptions` had inline `v.union(...)` for `plan` and `status`** that did not previously reference `planValidator` / `subscriptionStatusValidator` despite those existing in `convex/lib/validators.ts:3-29`. This commit unifies them. Verify the inline schema union and the `planValidator` shape have the same literal set before swapping — they do (audited 2026-05-13).
- **`pendingFromPlan` / `pendingToPlan`**: the schema declares them as inline `v.optional(v.union(v.literal("free"), …))`. The validator uses `v.optional(planValidator)`. The two are structurally identical but `planValidator` is the deduplicated form — keep it.
- **`creditType` literal union**: appears in both `creditsValidator` (nope — `creditsValidator` does not have `creditType`, only `creditTransactionValidator` does) and `creditTransactionValidator`. Inline it in `creditTransactionFields` rather than introducing a fourth top-level union export.
- **`metadata: v.record(v.string(), v.string())`** is preserved as-is. It is the escape hatch for non-promoted scoping; do NOT promote any metadata key into a top-level field without a corresponding schema change.
- **Avoid pulling in additional indexes** — the schema's `.index(...)` chain stays attached to `defineTable(xFields)`. Indexes are not part of the field-object.
- **Schema imports**: after this plan, `convex/schema.ts` imports from BOTH `./extraction/validators` (existing: `errorCodeValidator`, etc.) AND `./lib/validators` (new: three field-objects + `billingTypeValidator`). Both imports are flat — no transitive cycle through `_generated/dataModel`.
