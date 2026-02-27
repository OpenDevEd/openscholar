---
phase: 01-subscription-lifecycle-correctness
verified: 2026-02-27T10:30:00Z
status: human_needed
score: 11/11 must-haves verified
human_verification:
  - test: "Navigate to /settings/billing with a past_due subscription and verify the red banner appearance"
    expected: "A red banner appears below the plan/status row with the text 'Payment failed. Update your payment method to keep your subscription active.' and an 'Update payment method' button"
    why_human: "Visual appearance, layout, and color cannot be verified programmatically; the code is correct but UX quality needs human confirmation"
  - test: "Click the 'Update payment method' button on the past_due banner"
    expected: "Redirects to the Stripe customer portal"
    why_human: "Real-time navigation behavior and Stripe portal integration cannot be verified programmatically"
  - test: "Access app features while subscription is past_due"
    expected: "All features remain fully accessible during the grace period — no access gates or restrictions"
    why_human: "Feature entitlement behavior under past_due depends on entitlements.ts and runtime behavior, not just static code"
---

# Phase 1: Subscription Lifecycle Correctness — Verification Report

**Phase Goal:** Fix subscription lifecycle correctness — webhook re-fetch, cancellation orphans, proration charging, schedule verification, payment failure handling
**Verified:** 2026-02-27T10:30:00Z
**Status:** human_needed — all automated checks pass; 3 items need human testing (visual banner UX)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When two webhook events for the same subscription arrive out of order, the subscription record reflects the latest Stripe state | VERIFIED | `http.ts` dispatches `handleSubscriptionWebhook` internalAction (not event payload) for both `customer.subscription.created` and `customer.subscription.updated`; the action calls `stripe.subscriptions.retrieve()` before syncing |
| 2 | When a user cancels their subscription, the existing subscription record is updated in place with no orphan free-plan records created | VERIFIED | `handleSubscriptionCanceled` in `internal.ts` calls `ctx.db.patch(subscription._id, {...})` only — no `ctx.db.insert` for a new free-plan record |
| 3 | When a user's Stripe subscription ID is preserved on canceled records for audit trail | VERIFIED | The patch in `handleSubscriptionCanceled` does NOT include `stripeSubscriptionId` — the field is left as-is, preserving the value |
| 4 | When a user has a scheduled downgrade and changes their payment method mid-period, the scheduled downgrade is not disrupted | VERIFIED | Webhook handlers re-fetch fresh Stripe state (which already reflects the schedule) instead of trusting the metadata-only payload that could corrupt schedule state |
| 5 | When a user upgrades from Starter to Pro, the proration difference is charged immediately | VERIFIED | `changePlan` passes `proration_behavior: "always_invoice"` and `payment_behavior: "error_if_incomplete"` to `stripe.subscriptions.update` on the `upgraded_immediately` path |
| 6 | When a proration charge fails (card declined), the upgrade is blocked and the user stays on their current plan | VERIFIED | `catch` block catches `Stripe.errors.StripeCardError` and throws `createError("BILLING_CHARGE_FAILED", ...)` |
| 7 | When a user requests an upgrade preview, they see the exact proration amount that will be charged | VERIFIED | `getUpgradePreview` action calls `stripe.invoices.createPreview()` with `proration_behavior: "always_invoice"` and returns `prorationAmountCents`, `immediateChargeCents` |
| 8 | When a user re-upgrades after scheduling a downgrade, the orphaned subscription schedule is fully released and verified null | VERIFIED | Both `upgraded_immediately` and `pending_change_cleared` code paths call `stripe.subscriptions.retrieve(stripeSubscription.id)` after `subscriptionSchedules.release()` and throw `BILLING_PLAN_CHANGE_CONFLICT` if `verifiedSub.schedule !== null` |
| 9 | When a payment fails, the subscription transitions to past_due with a recorded pastDueSince timestamp | VERIFIED | `handlePaymentFailed` sets `patch.pastDueSince = now` only when `!subscription.pastDueSince` (first transition), then calls `ctx.db.patch` |
| 10 | When the grace period expires (7 days after pastDueSince), the subscription is automatically downgraded to free plan | VERIFIED | `checkSubscriptionStatus` in `maintenance/internal.ts` uses `GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000` and patches status to `"canceled"`, plan to `"free"`, `creditsPerMonth: 0`, clears `pastDueSince` |
| 11 | When a user's payment succeeds during the grace period, the pastDueSince field is cleared and the banner disappears | VERIFIED | `syncSubscription` spreads `{ pastDueSince: undefined }` when `args.status !== "past_due"` — recovery from Stripe fires a webhook, re-fetches fresh state, and clears the field |

**Score: 11/11 truths verified**

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/http.ts` | Webhook handlers that re-fetch from Stripe API before syncing | VERIFIED | Lines 275-310: `customer.subscription.created` and `.updated` dispatch `handleSubscriptionWebhook` internalAction; `customer.subscription.deleted` calls `handleSubscriptionCanceled` |
| `convex/subscriptions/actions.ts` | `handleSubscriptionWebhook` internalAction + fixed `changePlan` + new `getUpgradePreview` | VERIFIED | Line 160: `handleSubscriptionWebhook` exported; line 525: `changePlan`; line 798: `getUpgradePreview` |
| `convex/subscriptions/internal.ts` | In-place cancellation handler + `handlePaymentFailed` with `pastDueSince` + `syncSubscription` clearing `pastDueSince` | VERIFIED | Lines 465-507: `handleSubscriptionCanceled` (no orphan insert); lines 509-540: `handlePaymentFailed`; lines 444-459: `syncSubscription` paste clears `pastDueSince` |
| `convex/subscriptions/lib/selectCanonicalSubscription.ts` | Updated documentation reflecting post-SUB-03 data shape | VERIFIED | Lines 1-20: JSDoc updated describing that canceled records retain `stripeSubscriptionId` and priority order is preserved |
| `convex/schema.ts` | `pastDueSince` field on subscriptions table | VERIFIED | Line 95: `pastDueSince: v.optional(v.number())` |
| `convex/lib/validators.ts` | `pastDueSince` in `subscriptionValidator` | VERIFIED | Line 94: `pastDueSince: v.optional(v.number())` |
| `convex/maintenance/internal.ts` | `checkSubscriptionStatus` cron with 7-day grace period auto-downgrade | VERIFIED | Lines 62-118: `GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000`; loops over `past_due` subscriptions and downgrades if expired |
| `app/settings/billing/page.tsx` | Payment failure banner with "Update payment method" button for `past_due` | VERIFIED | Lines 388-407: `status === "past_due"` renders red banner with `AlertCircle` and `Button` calling `handleManageSubscription` |
| `convex/lib/errors.ts` | `BILLING_CHARGE_FAILED` error code | VERIFIED | Line 46: `"BILLING_CHARGE_FAILED"` in `ErrorCode` union |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/http.ts` customer.subscription.* | `convex/subscriptions/actions.ts handleSubscriptionWebhook` | `ctx.runAction(internalApi.subscriptions.actions.handleSubscriptionWebhook, ...)` | WIRED | Lines 280, 294 in `http.ts` |
| `handleSubscriptionWebhook` | Stripe API | `stripe.subscriptions.retrieve(args.stripeSubscriptionId)` | WIRED | Line 170 in `actions.ts` |
| `handleSubscriptionWebhook` | `syncSubscription` | `syncLocalSubscriptionFromStripe(ctx, fresh)` which calls `ctx.runMutation(internalApi.subscriptions.internal.syncSubscription, ...)` | WIRED | Lines 194, 140-150 in `actions.ts` |
| `convex/subscriptions/internal.ts handleSubscriptionCanceled` | `selectCanonicalSubscription` | `selectCanonicalSubscription(subscriptions)` to find the record to patch | WIRED | Line 476 in `internal.ts` |
| `changePlan` upgraded_immediately | Stripe API `always_invoice` | `stripe.subscriptions.update(..., { proration_behavior: "always_invoice", payment_behavior: "error_if_incomplete" })` | WIRED | Lines 687-699 in `actions.ts` |
| `changePlan` schedule release | verification | `stripe.subscriptions.retrieve()` then `if (verifiedSub.schedule !== null)` throw | WIRED | Lines 635-646, 673-684 in `actions.ts` |
| `getUpgradePreview` | Stripe API createPreview | `stripe.invoices.createPreview({...subscription_details: {proration_behavior: "always_invoice"}})` | WIRED | Lines 843-853 in `actions.ts` |
| `handlePaymentFailed` | schema `pastDueSince` | `patch.pastDueSince = now` when `!subscription.pastDueSince` | WIRED | Lines 532-534 in `internal.ts` |
| `syncSubscription` | schema `pastDueSince` (clear on recovery) | `...(args.status !== "past_due" ? { pastDueSince: undefined } : {})` | WIRED | Lines 456-458 in `internal.ts` |
| `checkSubscriptionStatus` | schema `pastDueSince` | `sub.pastDueSince ?? sub.updatedAt` used to calculate grace period expiry | WIRED | Line 78 in `maintenance/internal.ts` |
| `app/settings/billing/page.tsx` | past_due banner | `{status === "past_due" && <div>...banner...</div>}` with `handleManageSubscription` portal link | WIRED | Lines 388-407 in `page.tsx` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SUB-01 | 01-02-PLAN | Upgrade charges proration immediately via `always_invoice` | SATISFIED | `changePlan`: `proration_behavior: "always_invoice"`, `payment_behavior: "error_if_incomplete"` at line 695-696; `getUpgradePreview` exists at line 798 |
| SUB-02 | 01-01-PLAN | `syncSubscription` guards against out-of-order events using Stripe API re-fetch | SATISFIED | `handleSubscriptionWebhook` internalAction re-fetches from Stripe before every sync; both `created` and `updated` handlers use it |
| SUB-03 | 01-01-PLAN | Cancellation handler preserves Stripe subscription ID, no orphan free-plan records | SATISFIED | `handleSubscriptionCanceled` patches existing record in place; no `db.insert`; `stripeSubscriptionId` not patched (preserved) |
| SUB-04 | 01-01-PLAN | Downgrade schedule survives mid-period subscription updates | SATISFIED | Re-fetch approach inherently uses Stripe's fresh state (which includes the schedule); non-billing updates don't alter schedule in Stripe |
| SUB-05 | 01-02-PLAN | Schedule leak prevented — verify `subscription.schedule === null` after upgrade | SATISFIED | Both `upgraded_immediately` and `pending_change_cleared` paths verify `verifiedSub.schedule !== null` and throw `BILLING_PLAN_CHANGE_CONFLICT` if check fails |
| SUB-06 | 01-03-PLAN | Payment failure transitions to `past_due` with grace period, banner, and auto-downgrade | SATISFIED | `pastDueSince` schema field, `handlePaymentFailed` sets it on first transition, `syncSubscription` clears on recovery, `checkSubscriptionStatus` downgrades after 7 days, billing page shows red banner |

**All 6 requirements (SUB-01 through SUB-06) satisfied. No orphaned requirements found.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `convex/subscriptions/actions.ts` | 300 | `return []` | Info | Not a stub — this is a valid early-exit guard in `getPlans` when no valid price IDs are provided. Not in Phase 1 scope. |

**No blockers. No warnings. No stub patterns detected in Phase 1 modified files.**

---

### Human Verification Required

#### 1. Past-Due Payment Failure Banner

**Test:** With a test account in `past_due` status (use Stripe CLI: `stripe trigger invoice.payment_failed`), navigate to `/settings/billing`
**Expected:** A red banner appears below the plan/status row showing "Payment failed. Update your payment method to keep your subscription active." with an "Update payment method" button
**Why human:** Visual appearance (color, layout, spacing), text content rendering through i18n layer, and banner placement relative to other UI elements cannot be verified by static code analysis

#### 2. Update Payment Method Portal Link

**Test:** Click the "Update payment method" button on the past_due banner
**Expected:** The button triggers `handleManageSubscription`, which calls `createPortalSession`, and redirects to the Stripe customer portal
**Why human:** Real-time navigation behavior and Stripe portal URL generation require an active Stripe integration to verify

#### 3. Feature Access During Grace Period

**Test:** While subscription is `past_due`, attempt to use a paid feature (e.g., run an extraction job)
**Expected:** The feature is fully accessible — no access gates, no 402 errors, no upgrade prompts based on `past_due` status
**Why human:** Entitlement behavior under `past_due` is runtime-dependent on `isEntitledStatus()` and other middleware; static analysis confirms `past_due` is in the entitled set, but actual feature gating requires testing

---

## Gaps Summary

None. All automated checks pass. The phase goal is fully achieved at the code level.

The three human verification items are confirmatory checks on visual UX quality and live Stripe integration behavior — not blockers to phase completion.

---

## Technical Notes

### Architectural Deviation (Documented in SUMMARY)

Plan 01-01 specified creating a Stripe client directly in `http.ts` for re-fetching. The executor correctly identified that `http.ts` runs in Convex's JS runtime (not Node.js) and cannot use the `stripe` npm package. The fix was to create `handleSubscriptionWebhook` as an `internalAction` in `actions.ts` (which has `"use node"`) and call it via `ctx.runAction()`. This achieves the same functional outcome — Stripe re-fetch on every event — with an appropriate Convex runtime adaptation.

### isPaymentPending Banner Mutual Exclusion

The billing page correctly excludes `past_due` from the `isPaymentPending` computation:
```typescript
const isPaymentPending =
  (status === "incomplete" || details?.entitlementState === "payment_pending") &&
  status !== "past_due";
```
This prevents double banners (both `past_due` and `isPaymentPending` would otherwise show for the same condition).

---

_Verified: 2026-02-27T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
