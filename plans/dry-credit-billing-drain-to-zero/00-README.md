# DRY credit billing — uniform pre-flight + drain-to-zero

## Motivation

The recent chat-billing fix (`convex/chat/billing.ts`) introduced a clean two-step pattern for AI features:

1. **Pre-flight**: estimate cost from a fixed `ESTIMATED_CREDITS_PER_*` constant; throw `AI_INSUFFICIENT_CREDITS` if `balance.total < required`.
2. **Drain-to-zero**: pass `allowPartial: true` to `deductCreditsTransaction`; capture `result.deducted`; bill the row from the actual deducted amount, not the estimate.

The full audit (see `audit summary` below) found:

- **Pre-flight coverage**: every AI feature has *some* form of pre-flight check, **except `convex/wallet/gateway/handler.ts:134`** which only checks `balance.total <= 0`.
- **Drain-to-zero coverage**: only `convex/chat/billing.ts` (4 sites) is on the new pattern. Every other AI feature still goes through the public `deductCredits` mutation, which throws on shortfall.

The structural blocker is the **public `deductCredits` mutation** at `convex/credits/internal.ts:1683-1707`. Its `args` validator does not expose `allowPartial`, and its `returns` validator is `v.number()` (just the remaining balance), so callers cannot opt into drain-to-zero or recover the actual deducted amount.

## Locked design decisions (2026-05-06)

- **One mutation, one shape.** Extend the existing `deductCredits` to accept `allowPartial: v.optional(v.boolean())` and return `v.object({ deducted: v.number(), remaining: v.number() })`. No sibling mutation, no compatibility shim. Per project doctrine: "no legacy, no compatibility".
- **Default behavior is unchanged.** When `allowPartial` is absent or `false`, the mutation still throws `INSUFFICIENT_CREDITS` on shortfall — only the *return shape* changes. This preserves correctness for every caller that currently expects shortfall to throw.
- **Drain-to-zero policy is opt-in.** Every AI billing path opts in by passing `allowPartial: true`. Non-AI billing paths (admin grants, refunds via `addCredits`, etc.) are not touched.
- **Aggregator mirrors must use actual deducted.** `recordCreditSpend` calls in `convex/extraction/mutations/results.ts:248` and `convex/extraction/mutations/papers.ts:253` currently mirror with `args.creditsUsed` / `args.billing.creditsToDeduct`. After migration they MUST mirror with `result.deducted`, otherwise the `creditsAgg` B-tree overstates spend.
- **`applyBatchItemDeductions` callback stays as-is.** Its existing INSUFFICIENT_CREDITS catch-and-salvage path is the per-item drain equivalent — switching to `allowPartial` would silently process exhausted items as `deducted: 0` with no error signal. Per-item granularity is the correct drain unit for batch flows.
- **Wallet gateway pre-flight gets a real estimate.** Add `ESTIMATED_CREDITS_PER_WALLET_API_CALL = 200` to `convex/lib/constants.ts`; when `web_search_options` is present, additively use `ESTIMATED_CREDITS_PER_WEB_SEARCH` (already defined). Replace the `<= 0` check.

## Plan-file inventory

- `01-extend-public-deduct-mutation.md` — extend `deductCredits` args + returns; update all existing test files for the new shape; add new test exercising allowPartial through the public mutation.
- `02-migrate-ai-helpers-wrappers.md` — migrate the 3 single-call deductions in `convex/ai/helpers.ts` to drain-to-zero. Leave `applyBatchItemDeductions` callback alone.
- `03-migrate-direct-callers.md` — migrate `convex/extraction/mutations/results.ts:234`, `convex/extraction/mutations/papers.ts:238`, and `convex/wallet/gateway/handler.ts:270`. The two extraction sites must mirror their `recordCreditSpend` call with `result.deducted`.
- `04-tighten-wallet-gateway-preflight.md` — add `ESTIMATED_CREDITS_PER_WALLET_API_CALL` constant; replace `<= 0` gate with estimate-based gate.

## Dependency graph

```
01 (mutation extension)
 ├── 02 (helpers — depends on new return shape)
 ├── 03 (direct callers — depends on new return shape)
 └── 04 (gateway preflight — independent of return shape, can land in parallel with 02/03)
```

Plans 02 and 03 depend on 01 because both consume `result.deducted` and `result.remaining` from the new return shape. Plan 04 only adds a constant + edits one comparison; it can land independently but is naturally bundled with 03 since both touch `wallet/gateway/handler.ts`.

## Reuse / DRY notes

- `deductCreditsTransaction` (`convex/credits/internal.ts:1536`) **already** supports `allowPartial` and returns `{ deducted, remaining }`. We are exposing what the underlying transaction already does, not adding new logic.
- `applyBatchItemDeductions` (`convex/ai/lib/applyBatchItemDeductions.ts`) is the per-item batch drain mechanism. Reuse it; do not migrate its callback.
- `ESTIMATED_CREDITS_PER_WEB_SEARCH` (`convex/lib/constants.ts:46`) is already used by chat. Reuse it for the gateway preflight when `web_search_options` is set.
- `ESTIMATED_CREDITS_PER_CHAT_MESSAGE` (`convex/lib/constants.ts:36`) is the analog for chat. The new `ESTIMATED_CREDITS_PER_WALLET_API_CALL` constant should sit next to it with the same comment shape.

## Testing doctrine

- TDD mandatory for plan 01 — write a failing test exercising the new return shape, then implement the schema change.
- Plans 02–04 are test-after: they consume the new shape; correctness is proven by (a) `tsc --noEmit` clean (the new return shape is destructured), (b) existing call-site tests passing under the new shape, (c) one new test per migrated site asserting that the row's `billedCredits` (or aggregator entry) reflects `result.deducted` rather than the input estimate when balance is short.
- Behavioral assertions only — never assert on Tailwind class strings.
- Run `npx vitest run convex/credits/deduct-credits.test.ts convex/credits/aggregates.test.ts convex/wallet/wallet.test.ts convex/wallet/gateway/gateway.test.ts` after each plan.

## Migration stance

Pre-testing project, dev DB is disposable, schema validators are breaking by default.

The mutation's `returns` validator changes from `v.number()` to `v.object({ deducted, remaining })`. This is a wire-shape break. Every existing test and every existing caller is updated **in plan 01's commit** so the dev push never observes a broken intermediate state. No widen-then-narrow.

## Delegation policy

Inline implementation by the main session — the change is concentrated in 6 files plus their test files, fits in one focused execution pass. Subagents would add round-trip cost without parallelism benefit because each plan has serialized commits.

## Grounding sources

- `convex/_generated/ai/guidelines.md` — Convex function-registration, validators, mutation guidelines.
- `convex/credits/internal.ts:1503-1707` — `billingTypeValidator`, `DeductCreditsArgs` type, `deductCreditsTransaction`, public `deductCredits` mutation.
- `convex/ai/helpers.ts:240-552` — the three wrappers and the batch callback.
- `convex/ai/lib/applyBatchItemDeductions.ts` — batch salvage mechanism that stays unchanged.
- `convex/chat/billing.ts:396, 487, 562, 652` — exemplar drain-to-zero pattern.
- Audit summary (this conversation) — confirmed 9 AI features, 26 deductCredits call sites across 8 files.

## Audit summary (confirmed)

**Server-side AI features (9):**

1. Chat reply (streaming, ± web search) — `convex/chat/messages.ts:286`
2. Paper extraction — per-question LLM call — `convex/extraction/workpoolActions.ts:1117`
3. Paper extraction — PDF embedding index — `convex/extraction/workpoolActions.ts:621`
4. Batch screening — `convex/screening/workpoolActions.ts:39`, `convex/ai/actions.ts:50`
5. Batch translation — `convex/ai/actions.ts:103, 150`
6. Screening response generation — `convex/ai/actions.ts:124`
7. Search-query enhancement — `convex/ai/actions.ts:32`
8. Extraction-question generation — `convex/ai/actions.ts:67`
9. Wallet OpenAI-gateway HTTP endpoint — `convex/wallet/gateway/handler.ts:61`

**Pre-flight pass/fail:** all features ✅, except #9 (`<= 0` only) — fixed in plan 04.

**Drain-to-zero pass/fail:** only chat ✅; the other 8 throw on shortfall — fixed in plans 02 + 03.
