---
phase: 03-operational-hardening
verified: 2026-02-27T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 3: Operational Hardening Verification Report

**Phase Goal:** The billing system is observable, self-correcting for stale state, globally idempotent, and has a documented strategy for credit deduction races at scale
**Verified:** 2026-02-27
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Active subscriptions whose local state diverges from Stripe are auto-corrected by re-fetching from Stripe API and calling syncSubscription | VERIFIED | `checkSubscriptionStatus` is an `internalAction` (line 133) that calls `stripe.subscriptions.retrieve`, compares all 4 fields (`status`, `currentPeriodEnd`, `plan`, `cancelAtPeriodEnd`), and on divergence calls `ctx.runMutation(internal.subscriptions.internal.syncSubscription, {...})` |
| 2  | When a Stripe event in stripeEventLogs has failed status for more than 1 hour, monitorFailedStripeEvents logs a console.error alert with event details | VERIFIED | `monitorFailedStripeEvents` (line 247) computes `oneHourAgo = Date.now() - 60*60*1000`, filters `failedEvents` by `e.updatedAt < oneHourAgo`, and calls `console.error("[ALERT] Stale failed Stripe event", {...})` per event |
| 3  | checkSubscriptionStatus runs every 1 hour and monitorFailedStripeEvents runs every 1 hour | VERIFIED | `crons.ts` line 15-18: "check subscription status" at `{ hours: 1 }`; lines 21-25: "monitor failed stripe events" at `{ hours: 1 }` |
| 4  | All 4 financial webhook handlers (invoice.paid, charge.refunded, checkout.session.completed, payment_intent.succeeded) have inline IDEMPOTENCY CONTRACT JSDoc with dedup mechanism, replay behavior, and side effect guards | VERIFIED | `grep -c "IDEMPOTENCY CONTRACT" convex/http.ts` returns 4; each contract documents dedup gate, replay behavior, side effects, and verification date (2026-02-27) |
| 5  | The deductCredits mutation has an inline TOCTOU CONTRACT documenting the race condition, current OCC protection scope, theoretical risk window, and recommended mitigation path | VERIFIED | `grep -c "TOCTOU CONTRACT" convex/credits/internal.ts` returns 1; all five required sections present: Current Protection, Theoretical Risk Window, Why This Is Safe Today, Trigger for Additional Mitigation, Recommended Mitigation Path |

**Score:** 5/5 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/maintenance/internal.ts` | Corrective sync internalAction and failed event monitor internalMutation | VERIFIED | `checkSubscriptionStatus = internalAction` (line 133); `monitorFailedStripeEvents = internalMutation` (line 247); `expirePastDueSubscriptions = internalMutation` (line 76); `"use node"` at top |
| `convex/subscriptions/internal.ts` | listActiveSubscriptions internalQuery | VERIFIED | `listActiveSubscriptions = internalQuery` (line 187); returns array of active subscriptions filtered to those with `stripeSubscriptionId` |
| `convex/crons.ts` | Updated cron intervals and new monitoring cron | VERIFIED | "check subscription status" at `{ hours: 1 }` (line 17); "monitor failed stripe events" at `{ hours: 1 }` (line 24); no 24h interval remains for checkSubscriptionStatus |
| `convex/http.ts` | IDEMPOTENCY CONTRACT JSDoc on each financial webhook handler | VERIFIED | 4 IDEMPOTENCY CONTRACT blocks present — one per handler: checkout.session.completed, payment_intent.succeeded, charge.refunded, invoice.paid |
| `convex/credits/internal.ts` | TOCTOU CONTRACT on deductCredits; IDEMPOTENCY CONTRACT on grant/refund mutations | VERIFIED | 2 IDEMPOTENCY CONTRACT blocks (grantPurchasedCreditsFromPaymentIntent, reversePurchasedCreditsFromRefund); 1 TOCTOU CONTRACT block (deductCredits) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/maintenance/internal.ts` | `convex/subscriptions/internal.ts` | `ctx.runQuery(internal.subscriptions.internal.listActiveSubscriptions)` | WIRED | Line 142: `const activeSubs = await ctx.runQuery(internal.subscriptions.internal.listActiveSubscriptions)` |
| `convex/maintenance/internal.ts` | `convex/subscriptions/actions.ts` (syncSubscription) | `ctx.runMutation(internal.subscriptions.internal.syncSubscription, {...})` | WIRED | Line 210-223: full field mapping to `syncSubscription` on divergence detection |
| `convex/crons.ts` | `convex/maintenance/internal.ts` | crons.interval registration | WIRED | Line 21-25: `crons.interval("monitor failed stripe events", { hours: 1 }, internal.maintenance.internal.monitorFailedStripeEvents)` |
| `convex/http.ts` | `convex/credits/internal.ts` | invoice.paid -> processInvoiceForGrantNonBlocking | WIRED | Line 304: `await processInvoiceForGrantNonBlocking(ctx, event, invoice)` |
| `convex/http.ts` | `convex/credits/internal.ts` | payment_intent.succeeded -> grantPurchasedCreditsFromPaymentIntent | WIRED | Line 228: `await ctx.runMutation(internalApi.credits.internal.grantPurchasedCreditsFromPaymentIntent, {...})` |
| `convex/http.ts` | `convex/credits/internal.ts` | charge.refunded -> reversePurchasedCreditsFromRefund | WIRED | Line 266: `await ctx.runMutation(internalApi.credits.internal.reversePurchasedCreditsFromRefund, {...})` |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFRA-01 | 03-01-PLAN.md | `checkSubscriptionStatus` cron takes corrective action on stale/expired subscriptions (not just log warnings) | SATISFIED | Converted from `internalMutation` to `internalAction` with Stripe API re-fetch; calls `syncSubscription` on divergence; divergence check covers status, currentPeriodEnd, plan, cancelAtPeriodEnd |
| INFRA-02 | 03-01-PLAN.md | Failed Stripe events trigger monitoring/alerting if unresolved within N hours | SATISFIED | `monitorFailedStripeEvents` queries `stripeEventLogs` with `status === "failed"`, filters `updatedAt < oneHourAgo`, emits `console.error` per stale event plus summary count |
| INFRA-03 | 03-02-PLAN.md | All webhook handlers are idempotent — reprocessing the same event produces identical outcomes | SATISFIED | 4 IDEMPOTENCY CONTRACT blocks in `http.ts`; 2 in `credits/internal.ts`; each documents dedup gate, replay behavior, and side effect guards |
| INFRA-04 | 03-02-PLAN.md | TOCTOU credit deduction race condition is documented with mitigation strategy for scale | SATISFIED | 1 TOCTOU CONTRACT block on `deductCredits` in `credits/internal.ts` with all required sections: Current Protection, Theoretical Risk Window, trigger criteria (observed incident only), Recommended Mitigation Path (Option A: per-user workpool) |

All 4 requirements from the traceability table in REQUIREMENTS.md (INFRA-01 through INFRA-04) map to plans in this phase and have verified implementation evidence. No orphaned requirements found.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME/placeholder comments, empty implementations, or stub returns found in any of the 5 modified files. The `monitorFailedStripeEvents` function correctly uses `flag-only` behavior (console.error, no auto-retry) as required by the locked decision.

One notable design choice: `fresh` Stripe subscription response is cast to `any` in `checkSubscriptionStatus` (line 148) to access `current_period_end`/`current_period_start` properties not present in the 2026-01-28.clover Stripe type definitions. This is consistent with the pattern in `convex/subscriptions/actions.ts` and is documented in the SUMMARY as an accepted deviation.

---

## Human Verification Required

None required. All goal aspects are verifiable from code:

- Corrective sync logic is deterministic and fully readable in `convex/maintenance/internal.ts`
- Monitoring alert logic has no UI component — purely console.error output to Convex dashboard
- Contract documentation is static JSDoc — no runtime behavior to test manually

---

## Commits Verified

All 4 task commits from SUMMARY files verified to exist in git history:

| Commit | Plan | Description |
|--------|------|-------------|
| `e1d7c17` | 03-01 Task 1 | feat(03-01): convert checkSubscriptionStatus to corrective sync internalAction |
| `9c08c9c` | 03-01 Task 2 | feat(03-01): update cron intervals and add failed event monitoring cron |
| `7f1d1f8` | 03-02 Task 1 | docs(03-02): add IDEMPOTENCY CONTRACT JSDoc on all financial webhook handlers |
| `22e40da` | 03-02 Task 2 | docs(03-02): add TOCTOU CONTRACT JSDoc on deductCredits mutation |

---

## Summary

Phase 3 goal is fully achieved. The billing system is now:

1. **Observable** — `monitorFailedStripeEvents` runs hourly, emitting `console.error` alerts for any failed Stripe events unresolved for more than 1 hour. The Convex dashboard provides immediate visibility.

2. **Self-correcting for stale state** — `checkSubscriptionStatus` (now an `internalAction`) re-fetches every active Stripe subscription from the Stripe API hourly. It detects divergence across four fields (status, currentPeriodEnd, plan, cancelAtPeriodEnd) and silently corrects via `syncSubscription`. Past-due grace period expiry is preserved in the separate `expirePastDueSubscriptions` mutation called as the first step.

3. **Globally idempotent** — All 4 financial webhook handlers have formal IDEMPOTENCY CONTRACT documentation. The handlers were already idempotent through existing dedup gates; the phase added documentation proving this. Backing mutations `grantPurchasedCreditsFromPaymentIntent` and `reversePurchasedCreditsFromRefund` also have idempotency contracts.

4. **Documented strategy for credit deduction races** — The TOCTOU CONTRACT on `deductCredits` explains why OCC serialization is sufficient today (mutation-level re-read prevents negative balances), identifies the trigger for additional mitigation (observed negative-balance incident), and recommends per-user workpool as the mitigation path.

---

_Verified: 2026-02-27_
_Verifier: Claude (gsd-verifier)_
