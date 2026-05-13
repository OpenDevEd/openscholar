# Plan 01 — Hotfix `creditTransactionValidator.searchableText` drift

## Goal

Add `searchableText: v.optional(v.string())` to `creditTransactionValidator` so the field stops being silently stripped from every `getTransactions` return payload. Tactical one-liner that mirrors commit `8b42ef11` (the `questionsBilled` fix). Ships before the structural SSOT migration so the live wire shape is correct immediately.

## Scope

- One file: `convex/lib/validators.ts`.
- One new test: a focused test in `convex/credits/queries.test.ts` (or new `convex/credits/getTransactions.test.ts` if the file doesn't exist) that seeds a row with `searchableText` and asserts the value survives the `getTransactions` round-trip.
- Out of scope: the broader SSOT refactor (plan 03 folds this hotfix into the structural change).

## Design

```ts
// convex/lib/validators.ts:105
export const creditTransactionValidator = v.object({
  _id: v.id("creditTransactions"),
  _creationTime: v.number(),
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
  billingType: v.optional(/* … unchanged … */),
  metadata: v.optional(v.record(v.string(), v.string())),
  stripeInvoiceId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  stripeCheckoutSessionId: v.optional(v.string()),
  createdAt: v.number(),
  // billing-txn-perf plan-02: precomputed search string for the
  // `search_transactions` searchIndex. Defined on the table at
  // `convex/schema.ts:170`; was missing from this validator and
  // silently stripped from every `getTransactions` payload.
  searchableText: v.optional(v.string()),
});
```

One line addition. The comment block mirrors the schema-side comment so the next reader sees the field is intentional.

## TDD sequence

1. **R1 (red)**: in `convex/credits/queries.test.ts` (create the file if it doesn't exist, following the pattern of `convex/credits/aggregates.test.ts`), add a test:
   - Seed `users`, `credits`, and one `creditTransactions` row with `searchableText: "manual extraction job · openrouter/anthropic"` and a small balance change.
   - Call `api.credits.queries:getTransactions` with the seeded user identity.
   - Assert `result[0].searchableText` equals `"manual extraction job · openrouter/anthropic"`.
   - Vitest fails — the validator strips the field, so `result[0].searchableText` is `undefined`.
2. **G1 (green)**: add the `searchableText: v.optional(v.string())` line to `creditTransactionValidator`. Re-run vitest — green.

## Files touched

- `convex/lib/validators.ts:105` — add one line.
- `convex/credits/queries.test.ts` — add the new test (or create the file).

## Migration stance

Additive only. No schema change. No row-shape break. The field already exists on the table per `convex/schema.ts:170`; the validator is being widened to match. Pre-testing project, dev DB disposable, but no DB action is needed.

## Test plan

- `npx vitest run convex/credits/queries.test.ts` — new test green.
- `npx vitest run convex/credits` — no regression in existing credits tests.
- `npx tsc --noEmit` — clean.

## Deployability gate

After the commit:

- `npx pm2 logs convex --lines 5 --nostream` should show `✔ Convex functions ready!`.
- If pm2 is idle, `npx convex dev --once`. No `✖ Error`.
- Spot-check: in the dashboard, run `getTransactions` against a user with at least one credit-transaction whose `searchableText` is set, confirm the field is present on the wire. (The new test makes this redundant but it's the production confirmation.)

## Acceptance criteria

- `creditTransactionValidator` includes `searchableText: v.optional(v.string())`.
- A vitest test seeds a transaction with `searchableText` and asserts the value survives `getTransactions`.
- `npx tsc --noEmit` clean.
- pm2 deployability gate green after the commit.

## Known pitfalls

- **Convex `returns` validator with extra fields**: if `searchableText` were `v.string()` (required) the existing rows without it would throw. Use `v.optional(v.string())` because the schema declares it optional and the field is populated lazily per `convex/schema.ts:168-170`.
- **Test fixture credit-row setup**: `creditTransactions` requires `creditsId` (an Id<"credits">), not `userId`, as the primary scoping link. Read `convex/credits/queries.ts:80-92` for the exact seed shape — the test must insert a `credits` row first, then a `creditTransactions` row pointing at it.
- **Backfill awareness**: `searchableText` may be `undefined` on legacy rows. Assert presence only when the test seeds it explicitly; do not assert presence on a row the test did not write.
