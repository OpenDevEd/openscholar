---
phase: 09-lifecycle-and-credit-specs
verified: 2026-02-28T07:30:00Z
status: passed
score: 7/7 must-haves verified
must_haves:
  truths:
    - "A test downgrades a Pro user to Go and the billing page shows a pending-change banner and a scheduled badge on the Go card"
    - "A test cancels a scheduled downgrade and the billing page returns to showing Pro as the active plan without a pending-change banner"
    - "A test cancels a subscription and the billing page shows 'Expires on' instead of 'Renews on'"
    - "A test verifies a new free user receives signup credits and the billing page displays the correct balance"
    - "A test upgrades Go to Pro and verifies the pro-rata credit grant matches the calculated floor(remainingRatio * creditDelta)"
    - "A test purchases a credit topup via checkout-bypass and the billing page shows the increased balance"
    - "A test verifies a free-tier user at the credit cap sees the cap banner on the billing page"
  artifacts:
    - path: "e2e/billing/specs/downgrade.spec.ts"
      provides: "Downgrade E2E spec with Pro-to-Go downgrade and cancel-downgrade tests"
    - path: "e2e/billing/specs/cancel.spec.ts"
      provides: "Cancel subscription E2E spec"
    - path: "e2e/billing/specs/credits.spec.ts"
      provides: "Credit E2E spec with free signup, pro-rata, topup, and cap tests"
    - path: "e2e/billing/stripe-helpers.ts"
      provides: "createTopupBypass helper function for PaymentIntent-based credit topup"
  key_links:
    - from: "downgrade.spec.ts"
      to: "fixtures.ts"
      via: "import from ../fixtures"
    - from: "downgrade.spec.ts"
      to: "stripe-helpers.ts"
      via: "import createSubscriptionBypass, cleanupStripeCustomer"
    - from: "downgrade.spec.ts"
      to: "pricing-page.ts"
      via: "clickSubscribe('go') triggers downgrade"
    - from: "downgrade.spec.ts"
      to: "billing-page.ts"
      via: "pendingChangeBanner and clickKeepPlan()"
    - from: "cancel.spec.ts"
      to: "fixtures.ts"
      via: "import from ../fixtures"
    - from: "cancel.spec.ts"
      to: "stripe-helpers.ts"
      via: "import createSubscriptionBypass, cleanupStripeCustomer"
    - from: "cancel.spec.ts"
      to: "billing-page.ts"
      via: "renewalDate toContainText(/expires on/i)"
    - from: "credits.spec.ts"
      to: "fixtures.ts"
      via: "import from ../fixtures"
    - from: "credits.spec.ts"
      to: "stripe-helpers.ts"
      via: "import createTopupBypass"
    - from: "credits.spec.ts"
      to: "billing-page.ts"
      via: "getCreditBalance() and creditCapBanner"
    - from: "stripe-helpers.ts"
      to: "convex/http.ts"
      via: "billingType: credit_topup metadata in PaymentIntent"
---

# Phase 9: Lifecycle and Credit Specs Verification Report

**Phase Goal:** The remaining billing lifecycle flows -- downgrade, cancellation, credit topup, pro-rata upgrade credits, and free credit cap -- are covered by E2E tests
**Verified:** 2026-02-28T07:30:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A test downgrades a Pro user to Go and the billing page shows a pending-change banner and a scheduled badge on the Go card | VERIFIED | `downgrade.spec.ts:8-46` -- subscribes to Pro via bypass, clicks Go on pricing page, re-navigates, asserts `scheduledBadge` visible on pricing page and `pendingChangeBanner` visible on billing page |
| 2 | A test cancels a scheduled downgrade and the billing page returns to showing Pro as the active plan without a pending-change banner | VERIFIED | `downgrade.spec.ts:48-84` -- triggers downgrade, verifies banner appears, clicks `clickKeepPlan()`, re-navigates, asserts banner `not.toBeVisible()` and planName matches `/pro/i` |
| 3 | A test cancels a subscription and the billing page shows "Expires on" instead of "Renews on" | VERIFIED | `cancel.spec.ts:7-38` -- subscribes to Go, calls `stripeClient.subscriptions.update(subscriptionId, { cancel_at_period_end: true })`, navigates to billing page, asserts `renewalDate` contains `/expires on/i` |
| 4 | A test verifies a new free user receives signup credits and the billing page displays the correct balance | VERIFIED | `credits.spec.ts:9-16` -- navigates to billing page, calls `getCreditBalance()`, asserts `toBe(2_000)` exact match |
| 5 | A test upgrades Go to Pro and verifies the pro-rata credit grant matches the calculated floor(remainingRatio * creditDelta) | VERIFIED | `credits.spec.ts:18-82` -- subscribes to Go, reads Stripe subscription item period timestamps, upgrades via pricing page confirmation dialog, calculates `Math.floor(remainingRatio * 12_000)`, asserts within +-2 tolerance |
| 6 | A test purchases a credit topup via checkout-bypass and the billing page shows the increased balance | VERIFIED | `credits.spec.ts:84-129` -- subscribes to Go, records balance, calls `createTopupBypass()` with PaymentIntent metadata, waits for balance increase via webhook waiter, asserts `creditsAfter >= balanceBefore + 10_000` |
| 7 | A test verifies a free-tier user at the credit cap sees the cap banner on the billing page | VERIFIED | `credits.spec.ts:131-137` -- navigates to billing page as fresh free user, asserts `creditCapBanner` `toBeVisible()` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `e2e/billing/specs/downgrade.spec.ts` | Downgrade E2E spec, min 60 lines | VERIFIED | 85 lines, 2 tests in describe block, imports fixtures + stripe-helpers, exercises full downgrade + cancel-downgrade flows |
| `e2e/billing/specs/cancel.spec.ts` | Cancel subscription E2E spec, min 30 lines | VERIFIED | 38 lines, 1 test in describe block, imports fixtures + stripe-helpers, uses Stripe API cancel bypass |
| `e2e/billing/specs/credits.spec.ts` | Credit E2E spec, min 100 lines | VERIFIED | 138 lines, 4 tests in describe block, imports fixtures + stripe-helpers (including createTopupBypass), covers signup/pro-rata/topup/cap |
| `e2e/billing/stripe-helpers.ts` | Contains createTopupBypass helper | VERIFIED | 168 lines, exports `createTopupBypass` with PaymentIntent creation, correct `credit_topup` metadata, `confirm: true` + `off_session: true` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `downgrade.spec.ts` | `fixtures.ts` | `import from ../fixtures` | WIRED | Line 1: `import { test, expect } from "../fixtures"` |
| `downgrade.spec.ts` | `stripe-helpers.ts` | `createSubscriptionBypass` | WIRED | Lines 3-5: imports used at lines 18 and 58 |
| `downgrade.spec.ts` | `pricing-page.ts` | `clickSubscribe("go")` | WIRED | Lines 34 and 68: triggers downgrade flow |
| `downgrade.spec.ts` | `billing-page.ts` | `pendingChangeBanner, clickKeepPlan` | WIRED | Lines 42, 72, 75, 79: banner assertions + keep plan click |
| `cancel.spec.ts` | `fixtures.ts` | `import from ../fixtures` | WIRED | Line 1: `import { test, expect } from "../fixtures"` |
| `cancel.spec.ts` | `stripe-helpers.ts` | `createSubscriptionBypass` | WIRED | Lines 3-5: import, line 17: used for Go subscription |
| `cancel.spec.ts` | `billing-page.ts` | `renewalDate + expires on` | WIRED | Line 33: `billingPage.renewalDate` + `/expires on/i` assertion |
| `credits.spec.ts` | `fixtures.ts` | `import from ../fixtures` | WIRED | Line 1: `import { test, expect } from "../fixtures"` |
| `credits.spec.ts` | `stripe-helpers.ts` | `createTopupBypass` | WIRED | Line 5: imported, line 108: called with full args |
| `credits.spec.ts` | `billing-page.ts` | `getCreditBalance, creditCapBanner` | WIRED | Lines 14, 76, 124: getCreditBalance(); line 136: creditCapBanner |
| `stripe-helpers.ts` | `convex/http.ts` | `billingType: credit_topup` metadata | WIRED | Line 156: `billingType: "credit_topup"` matches webhook handler expectations |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PLAN-02 | 09-01 | User can downgrade from Pro to Go, sees pending-change banner and scheduled badge | SATISFIED | `downgrade.spec.ts` test 1: asserts pendingChangeBanner visible + scheduledBadge visible |
| PLAN-03 | 09-01 | User can cancel a scheduled downgrade to keep current Pro plan | SATISFIED | `downgrade.spec.ts` test 2: clicks clickKeepPlan(), asserts banner gone + Pro active |
| CNCL-01 | 09-01 | User can cancel subscription and billing page shows "Expires on" instead of "Renews on" | SATISFIED | `cancel.spec.ts`: Stripe API cancel_at_period_end, asserts `/expires on/i` |
| CRED-01 | 09-02 | User receives free signup credits on account creation and sees balance on billing page | SATISFIED | `credits.spec.ts` test 1: asserts `getCreditBalance() === 2_000` exact |
| CRED-03 | 09-02 | User receives pro-rata credits on upgrade matching calculated floor(remainingRatio * creditDelta) | SATISFIED | `credits.spec.ts` test 2: calculates from Stripe subscription item timestamps, asserts within +-2 |
| CRED-04 | 09-02 | User can purchase credit topup via checkout-bypass and see increased balance | SATISFIED | `credits.spec.ts` test 3: uses createTopupBypass, asserts balance increased by 10,000 |
| CRED-05 | 09-02 | Free-tier user at credit cap sees cap banner on billing page | SATISFIED | `credits.spec.ts` test 4: asserts creditCapBanner visible for fresh free user |

**Orphaned requirements check:** REQUIREMENTS.md traceability table maps PLAN-02, PLAN-03, CNCL-01, CRED-01, CRED-03, CRED-04, CRED-05 to Phase 9. All 7 are claimed by plans (09-01 claims PLAN-02, PLAN-03, CNCL-01; 09-02 claims CRED-01, CRED-03, CRED-04, CRED-05). No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | - |

No TODO, FIXME, PLACEHOLDER, empty implementations, or console.log-only handlers found in any phase artifacts.

### Human Verification Required

### 1. Downgrade Flow Visual Behavior

**Test:** Run `npx playwright test downgrade.spec.ts` against a live Stripe sandbox
**Expected:** Test passes -- pending-change banner appears after downgrade, disappears after cancel-downgrade, and Pro remains active
**Why human:** Requires live Stripe sandbox, Clerk test environment, and Convex deployment to execute end-to-end

### 2. Cancel Subscription "Expires on" Text

**Test:** Run `npx playwright test cancel.spec.ts` against a live Stripe sandbox
**Expected:** After `cancel_at_period_end: true`, billing page shows "Expires on" instead of "Renews on"
**Why human:** Requires live Stripe API interaction and real webhook delivery to Convex

### 3. Credit Balance Accuracy

**Test:** Run `npx playwright test credits.spec.ts` against a live Stripe sandbox
**Expected:** Free signup credits = 2,000 exact; pro-rata credits within +-2 of calculated value; topup increases balance by 10,000; cap banner visible for free user
**Why human:** Pro-rata calculation depends on real Stripe subscription timestamps and timing of webhook processing; topup requires PaymentIntent confirmation and webhook delivery

### 4. Stripe API Version Compatibility

**Test:** Verify `subscription.items.data[0].current_period_start/end` works with Stripe `2026-01-28.clover` API
**Expected:** Period fields are accessible on subscription items (not top-level subscription)
**Why human:** API version-specific behavior that changed in Stripe clover release

### Gaps Summary

No gaps found. All 7 observable truths from the success criteria are verified through code inspection. All 4 artifacts exist, are substantive (meet line count minimums), and are fully wired to their dependencies. All 7 requirement IDs (PLAN-02, PLAN-03, CNCL-01, CRED-01, CRED-03, CRED-04, CRED-05) are satisfied with concrete implementation evidence. No anti-patterns detected. All 4 commits from the summaries are verified in the git history.

---

_Verified: 2026-02-28T07:30:00Z_
_Verifier: Claude (gsd-verifier)_
