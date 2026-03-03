---
phase: 48-billing-hardening
verified: 2026-03-03T08:20:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 48: Billing Hardening Verification Report

**Phase Goal:** Stripe billing code uses proper types and safe plan resolution with no `as any` casts
**Verified:** 2026-03-03T08:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                              | Status     | Evidence                                                                                   |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 1   | Stripe webhook handlers cast event.data.object to typed SDK objects (no `as any`)                 | VERIFIED   | `http.ts` lines 114, 158, 196, 243, 256, 275, 289, 302 all use Stripe.Invoice/Subscription/Checkout.Session/PaymentIntent/Charge |
| 2   | stripeWebhookHandlers.ts utility functions use FunctionReference and Stripe.Invoice (no `any`)     | VERIFIED   | Lines 26, 51-52, 83-84: FunctionReference<"mutation"|"action", "internal">; line 81: Stripe.Invoice |
| 3   | subscriptions/actions.ts uses Stripe.Subscription type (no `as any` for Stripe objects)           | VERIFIED   | Lines 80, 98, 118: `Stripe.Subscription`; only remaining `as any` is `(error as any).decline_code` which is out-of-scope per plan decision |
| 4   | getPlanFromPriceId returns "free" with console.warn for unknown price IDs — no substring matching  | VERIFIED   | constants.ts lines 69-78: no `includes()` calls; `console.warn` on line 76 confirmed     |
| 5   | All existing tests pass after type changes and fallback removal                                    | VERIFIED   | 45/45 tests pass across stripe-webhook-handler.test.ts and plan-config.test.ts            |
| 6   | Pending plan change state is stored in Convex subscriptions table                                  | VERIFIED   | schema.ts lines 102-105: pendingFromPlan, pendingToPlan, pendingChangeTimestamp fields     |
| 7   | changePlan writes pending change fields to Convex subscription record                              | VERIFIED   | actions.ts: setPendingPlanChange called (line 853), clearPendingPlanChange called (689, 752) |
| 8   | getSubscriptionDetails reads pending change state from Convex subscription record first            | VERIFIED   | actions.ts lines 486-489: reads subscription.pendingToPlan and subscription.pendingFromPlan |
| 9   | handleSubscriptionCanceled clears pending plan change fields on cancellation                       | VERIFIED   | internal.ts lines 563-566: pendingFromPlan/pendingToPlan/pendingChangeTimestamp set to undefined |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact                              | Expected                                            | Status     | Details                                                                          |
| ------------------------------------- | --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| `convex/http.ts`                      | Typed Stripe webhook event handlers                 | VERIFIED   | All 5 webhook handlers use specific Stripe SDK types; zero `as any` in handlers  |
| `convex/lib/stripeWebhookHandlers.ts` | Type-safe webhook handler utilities                 | VERIFIED   | FunctionReference types for all mutation/action refs; Stripe.Invoice for invoice param |
| `convex/subscriptions/actions.ts`     | Type-safe subscription action handlers              | VERIFIED   | Stripe.Subscription used throughout; only out-of-scope `(error as any).decline_code` remains |
| `convex/lib/constants.ts`             | getPlanFromPriceId without substring fallback       | VERIFIED   | No `includes()` calls; console.warn present for unknown IDs                     |
| `convex/schema.ts`                    | subscriptions table with pending plan change fields | VERIFIED   | pendingFromPlan, pendingToPlan, pendingChangeTimestamp all present and optional   |
| `convex/subscriptions/internal.ts`    | setPendingPlanChange and clearPendingPlanChange mutations | VERIFIED | Both mutations exist at lines 745 and 763; handleSubscriptionCanceled clears fields |
| `convex/lib/validators.ts`            | subscriptionValidator with pending plan change fields | VERIFIED | Lines 97-99: pendingFromPlan, pendingToPlan, pendingChangeTimestamp all present  |

---

### Key Link Verification

| From                                  | To                                    | Via                                             | Status   | Details                                                                              |
| ------------------------------------- | ------------------------------------- | ----------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `convex/http.ts`                      | `convex/lib/stripeWebhookHandlers.ts` | `import.*stripeWebhookHandlers` (line 8-13)     | WIRED    | Imports getStripeObjectId, getStripeApiVersion, runAuditedStripeHandler, processInvoiceForGrantNonBlocking |
| `convex/lib/constants.ts`             | `convex/subscriptions/actions.ts`     | `getPlanFromPriceId` called (lines 10, 233, 327, 502, 587) | WIRED | getPlanFromPriceId imported and called in 5 places                                  |
| `convex/subscriptions/actions.ts`     | `convex/subscriptions/internal.ts`    | `setPendingPlanChange/clearPendingPlanChange` calls | WIRED | setPendingPlanChange called line 853 (downgrade); clearPendingPlanChange called lines 689 (clear) and 752 (upgrade) |
| `convex/subscriptions/actions.ts`     | `convex/schema.ts`                    | pendingFromPlan fields stored in subscriptions  | WIRED    | subscription.pendingToPlan read at line 486 (from getSubscriptionByUser); schema has fields |
| `convex/credits/actions.ts`           | `convex/subscriptions/internal.ts`    | upgradeFromPlan read from Stripe metadata (TODO for BILL-02 follow-up) | PARTIAL | Reads from Stripe metadata for now; TODO(BILL-02 follow-up) comment at line 374 — intentional, documented decision |

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                              | Status    | Evidence                                                                                        |
| ----------- | ----------- | ------------------------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------- |
| TYPE-01     | 48-01       | Stripe webhook handlers use typed SDK event objects instead of `as any`  | SATISFIED | http.ts: 5 handlers use specific Stripe types; stripeWebhookHandlers.ts: FunctionReference; actions.ts: Stripe.Subscription functions |
| BILL-01     | 48-01       | getPlanFromPriceId substring fallback removed; unknown IDs return "free" with warning | SATISFIED | constants.ts: no includes() calls; console.warn present; 45 tests pass including renamed substring fallback tests |
| BILL-02     | 48-02       | Pending plan change state stored in Convex subscriptions table           | SATISFIED | schema.ts, validators.ts, internal.ts mutations, actions.ts reads/writes all verified          |

No orphaned requirements. REQUIREMENTS.md maps only TYPE-01, BILL-01, BILL-02 to Phase 48 — all three are claimed by plans and verified.

---

### Anti-Patterns Found

| File                                    | Line | Pattern                             | Severity | Impact                                                                             |
| --------------------------------------- | ---- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `convex/subscriptions/actions.ts`       | 873  | `(error as any).decline_code`       | INFO     | Out of scope — accessing Stripe-specific property not on base StripeCardError type. Documented in 48-01 SUMMARY as intentional decision. No billing-critical path impact. |
| `convex/subscriptions/internal.ts`      | 591  | `const patch: Record<string, any>`  | INFO     | In `handlePaymentFailed` — a local patch object accumulator, not a Stripe object cast. Not a type-safety gap in the phase-48 sense. |

No blocker or warning anti-patterns found. Both INFO items are pre-existing, intentional patterns documented in the plan and summary.

---

### Human Verification Required

None — all phase-48 checks are verifiable programmatically. The dual-write pattern (Stripe metadata preserved for backward compatibility while Convex is now source of truth) is a documented architectural decision that does not require user-facing testing.

---

### Commit Verification

All four commits referenced in SUMMARYs confirmed to exist in git history:

- `2be3138` — feat(48-01): replace as-any casts with typed Stripe SDK objects (TYPE-01)
- `5d025bf` — fix(48-01): remove getPlanFromPriceId substring fallback (BILL-01)
- `eef40cf` — feat(48-02): add pending plan change fields to schema and validators
- `7435d85` — feat(48-02): move pending plan change state from Stripe to Convex

---

### Summary

Phase 48 goal is fully achieved. All three requirements (TYPE-01, BILL-01, BILL-02) are satisfied:

**TYPE-01:** Zero `as any` casts remain in Stripe webhook event handler sections of `http.ts`, `stripeWebhookHandlers.ts`, and `subscriptions/actions.ts`. The only surviving `as any` is `(error as any).decline_code` — a Stripe-specific property access on a StripeCardError that is explicitly out of scope per the plan's documented decisions.

**BILL-01:** `getPlanFromPriceId` has no substring fallback. Unknown price IDs return `"free"` with a `console.warn`. Test suite updated to verify post-BILL-01 behavior. All 45 tests pass.

**BILL-02:** Pending plan change state (`pendingFromPlan`, `pendingToPlan`, `pendingChangeTimestamp`) is stored in the Convex `subscriptions` table as optional fields. `changePlan` writes to Convex via `setPendingPlanChange` (downgrade) and `clearPendingPlanChange` (upgrade/clear). `getSubscriptionDetails` reads from Convex first with a Stripe schedule fallback for pre-migration data. `handleSubscriptionCanceled` clears pending fields on cancellation. The `credits/actions.ts` invoice webhook path retains a Stripe metadata read with a documented TODO for future migration — this is an intentional, backward-compatible decision.

---

_Verified: 2026-03-03T08:20:00Z_
_Verifier: Claude (gsd-verifier)_
