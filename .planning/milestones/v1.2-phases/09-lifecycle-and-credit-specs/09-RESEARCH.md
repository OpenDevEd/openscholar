# Phase 9: Lifecycle and Credit Specs - Research

**Researched:** 2026-02-28
**Domain:** Playwright E2E test specs for remaining billing lifecycle flows: downgrade, cancel downgrade, cancel subscription, free signup credits, pro-rata upgrade credits, credit topup, and free credit cap
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Three spec files mirroring logical flow groups:
  - `e2e/billing/specs/downgrade.spec.ts` -- downgrade Pro to Go + cancel scheduled downgrade (PLAN-02, PLAN-03)
  - `e2e/billing/specs/cancel.spec.ts` -- cancel subscription (CNCL-01)
  - `e2e/billing/specs/credits.spec.ts` -- free signup credits, pro-rata upgrade credits, credit topup, free credit cap (CRED-01, CRED-03, CRED-04, CRED-05)
- Use `describe` + `test` blocks (consistent with Phase 8)
- Each test is fully independent -- fresh Clerk user via billing fixture, no shared state
- Downgrade test: after triggering downgrade, assert pending-change banner is visible on billing page and contains downgrade-related text
- Downgrade test: assert scheduled badge appears on the Go plan card (not Pro)
- Cancel downgrade test: after canceling the scheduled change, assert pending-change banner disappears and Pro remains active
- Cancel subscription test: assert billing page shows "Expires on" instead of "Renews on" after cancellation
- Do NOT assert exact dates in banners (volatile, timing-dependent) -- assert text patterns only
- Free signup credits (CRED-01): assert exact expected balance for a fresh free user (known fixed amount)
- Pro-rata upgrade credits (CRED-03): calculate expected pro-rata at test time using `floor(remainingRatio * creditDelta)` from the Stripe subscription's current_period timestamps, then assert the displayed balance matches within a small tolerance (+-1 credit for rounding)
- Credit topup (CRED-04): subscribe user first, record balance, purchase topup via checkout-bypass, assert balance increased by the known topup amount
- Free credit cap (CRED-05): create a free user at or above the credit cap, assert cap banner is visible on billing page
- All credit checks use total balance only (consistent with Phase 8 -- no free vs paid breakdown)
- Every test is fully self-contained: creates fresh user, sets up required state, performs action, asserts, cleans up
- No sequential coupling between tests
- 09-01: Downgrade and cancel specs (`downgrade.spec.ts`, `cancel.spec.ts`) -- 3 tests total
- 09-02: Credit specs (`credits.spec.ts`) -- 4 tests total
- Both plans can run in parallel (wave 1) -- no dependencies between them

### Claude's Discretion
- Exact `describe` block naming and test descriptions
- Wait timing between actions and UI assertions (use webhook waiter patterns)
- Any additional page object methods or data-testid attributes needed
- How to drive the free credit cap state (pre-seed via API or consume credits in test)
- How to trigger downgrade and cancel actions in the UI (discover from existing components)
- Exact `describe` block naming and test descriptions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAN-02 | User can downgrade from Pro to Go, sees pending-change banner and scheduled badge | Downgrade is triggered via `changePlan({ targetPriceId: goPriceId })` which is called when clicking the Go plan button on the pricing page. The `changePlan` action detects `targetTier < currentTier` and creates a Stripe subscription schedule for period-end downgrade (returns `mode: "scheduled"`, `changeType: "downgrade_scheduled"`). After downgrade, `getSubscriptionDetails` returns `hasPendingChange: true` and `pendingTargetPlan: "go"`. The billing page renders `data-testid="billing-pending-change-banner"` when `hasPendingChange` is true. The pricing page renders `data-testid="pricing-scheduled-badge"` on the target plan card when `isScheduledTarget` is true. |
| PLAN-03 | User can cancel a scheduled downgrade to keep current Pro plan | Cancel is triggered via `handleKeepCurrentPlan()` on either the billing page or pricing page. This calls `changePlan({ targetPriceId: currentPriceId })` which detects `hasClearablePendingChange` and returns `changeType: "pending_change_cleared"`. The action releases the Stripe subscription schedule and clears pending plan metadata. After cancellation, `getSubscriptionDetails` returns `hasPendingChange: false`. The billing page hides the pending-change banner, and the pricing page removes the "Scheduled" badge from the Go card. The billing page has `data-testid="billing-keep-plan-button"` for the "Keep current plan" button. |
| CNCL-01 | User can cancel subscription and billing page shows "Expires on" instead of "Renews on" | Subscription cancellation is done via Stripe API: `stripe.subscriptions.update(subId, { cancel_at_period_end: true })`. This sets `cancel_at_period_end = true` on the subscription. The `handleSubscriptionWebhook` action re-fetches from Stripe and calls `syncSubscription` which stores `cancelAtPeriodEnd: true` in Convex. The billing page's `getSubscriptionDetails` action reads `cancelAtPeriodEnd` from Stripe and returns it. The billing page renders "Expires on" when `details.cancelAtPeriodEnd === true` and "Renews on" otherwise (line 540-541 of `app/settings/billing/page.tsx`). |
| CRED-01 | User receives free signup credits on account creation and sees balance on billing page | In `convex/lib/userCreation.ts`, `createUserWithDefaults()` creates a credits record with `freeBalance = FREE_SIGNUP_CREDIT_GRANT = 2,000` (from `convex/lib/constants.ts`). This happens when Clerk webhook creates the user, before any subscription. The billing page displays total credit balance via `data-testid="billing-credit-balance"`. A fresh free user should have exactly 2,000 credits. |
| CRED-03 | User receives pro-rata credits on upgrade matching calculated `floor(remainingRatio * creditDelta)` | The `changePlan` action calls `grantUpgradeProRataCredits` mutation which calculates: `creditDelta = PLAN_CONFIG[toPlan].creditsPerMonth - PLAN_CONFIG[fromPlan].creditsPerMonth`, `remainingRatio = (periodEnd - now) / (periodEnd - periodStart)`, `proRataCredits = floor(remainingRatio * creditDelta)`. For Go-to-Pro: `creditDelta = 15,000 - 3,000 = 12,000`. The test can read `current_period_start` and `current_period_end` from the Stripe subscription to calculate the expected value independently, then compare against the displayed balance with +-1 tolerance. |
| CRED-04 | User can purchase credit topup via checkout-bypass and see increased balance | Credit topup normally flows through `createTopupCheckoutSession` which creates a Stripe Checkout session in `mode: "payment"` with metadata `billingType: "credit_topup"` and `credits: N`. When the payment succeeds, the `payment_intent.succeeded` webhook calls `grantPurchasedCreditsFromPaymentIntent` which grants credits to `paidBalance`. For checkout-bypass, the test can create a PaymentIntent directly via Stripe API with the same metadata, then confirm it, which triggers the webhook. The smallest bundle is `credits_10000` (10,000 credits at $1.00). |
| CRED-05 | Free-tier user at credit cap sees cap banner on billing page | `getFreeCreditCapForPlan("free")` returns `FREE_SIGNUP_CREDIT_GRANT = 2,000`. The billing page checks `isFreeCapReached = creditBalance.free >= freeCreditCap` and renders `data-testid="billing-credit-cap-banner"` when true. Since a fresh free user starts with exactly 2,000 free credits and the cap is 2,000, the cap banner should be visible immediately for a new free user without any additional setup. |
</phase_requirements>

## Summary

Phase 9 writes three E2E test spec files that cover the remaining billing lifecycle flows using the Phase 7 infrastructure (billing fixture, page objects, Stripe helpers, webhook waiter) and following the Phase 8 spec patterns. All infrastructure is already built and proven.

The downgrade and cancel specs (`downgrade.spec.ts` and `cancel.spec.ts`) test plan change flows that happen through the pricing page UI. The downgrade test subscribes a user to Pro via checkout-bypass, then clicks "Downgrade to Go" on the pricing page which calls `changePlan` to create a Stripe subscription schedule. The test then asserts the pending-change banner and scheduled badge. The cancel-downgrade test extends this by clicking "Keep current plan" (via `billing-keep-plan-button` or the pricing page equivalent) and verifying the banner disappears. The cancel-subscription test uses the Stripe API to set `cancel_at_period_end: true` (bypassing the Stripe Customer Portal) and verifies the billing page shows "Expires on" instead of "Renews on".

The credit specs (`credits.spec.ts`) test four distinct credit behaviors. The free signup credits test is the simplest -- just verify a fresh user has 2,000 credits. The pro-rata upgrade test subscribes Go, upgrades to Pro, and calculates the expected pro-rata credit grant from the Stripe subscription timestamps. The credit topup test creates a PaymentIntent directly via Stripe API with the `credit_topup` metadata pattern (bypassing Stripe Checkout). The free credit cap test leverages the fact that a fresh free user starts at exactly the cap (2,000 free credits = 2,000 cap).

**Primary recommendation:** Follow Phase 8 patterns exactly -- each test imports from `../fixtures`, uses the billing fixture destructuring, and stays under 20 lines of test body. The key new patterns are: (1) triggering downgrade via the pricing page's `clickSubscribe("go")` when on Pro, (2) canceling subscriptions via Stripe API (checkout-bypass for portal), (3) creating PaymentIntents directly for credit topup bypass, and (4) reading Stripe subscription timestamps for pro-rata calculation.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.58.2 | Test runner, assertions, describe/test blocks | Already installed; billing project configured |
| Billing fixture | N/A | `test.extend` providing clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage | Built in Phase 7 at `e2e/billing/fixtures.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `stripe` | 20.3.0 | Checkout-bypass for subscriptions, cancellation API, PaymentIntent for topup | Every test that modifies Stripe state |
| `convex` CLI | 1.31.7 | WebhookWaiter polls Convex state | After Stripe API calls, before UI assertions |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
e2e/
  billing/
    fixtures.ts          # Phase 7 -- billing test fixture
    webhook-waiter.ts    # Phase 7 -- Convex state polling
    stripe-helpers.ts    # Phase 7 -- checkout-bypass, cleanup (may need topup helper)
    pages/
      billing-page.ts    # Phase 7 -- BillingPage POM (already has pendingChangeBanner, keepPlanButton, creditCapBanner)
      pricing-page.ts    # Phase 7 -- PricingPage POM (already has scheduledBadge)
    specs/
      subscribe.spec.ts  # Phase 8 -- existing
      upgrade.spec.ts    # Phase 8 -- existing
      downgrade.spec.ts  # Phase 9 -- NEW (PLAN-02, PLAN-03)
      cancel.spec.ts     # Phase 9 -- NEW (CNCL-01)
      credits.spec.ts    # Phase 9 -- NEW (CRED-01, CRED-03, CRED-04, CRED-05)
```

### Pattern 1: Downgrade via Pricing Page

**What:** Triggering a downgrade by clicking the Go plan button when the user has a Pro subscription.

**When to use:** PLAN-02 downgrade test.

**How it works:** The `Pricing` component's `getButtonConfig()` function detects when the target plan tier is lower than the current tier and renders a "Downgrade to Go" button. Clicking it calls `handleSubscribe("go")` which calls `changePlan({ targetPriceId: goPriceId })`. The `changePlan` action detects the downgrade and creates a Stripe subscription schedule (no dialog, unlike upgrades). After the call completes, the pricing page refreshes `subscriptionDetails` via `getSubscriptionDetails()`.

**Example:**
```typescript
// Subscribe to Pro first, then navigate to pricing and downgrade
await pricingPage.goto();
await pricingPage.clickSubscribe("go"); // This triggers changePlan with Go price ID

// Wait for the pricing page state to refresh (subscriptionDetails update)
// The pending-change banner appears on billing page
await billingPage.goto();
await expect(billingPage.pendingChangeBanner).toBeVisible();
```

**Key detail:** Downgrade does NOT open a confirmation dialog. It calls `changePlan` directly. The `isUpgrade` check in `handleSubscribe()` determines the flow: upgrades show a dialog, downgrades call `changePlan` immediately.

### Pattern 2: Cancel Scheduled Downgrade

**What:** Using the "Keep current plan" button to cancel a pending downgrade.

**When to use:** PLAN-03 cancel-downgrade test.

**How it works:** After a downgrade is scheduled, the billing page shows a pending-change banner with a "Keep current plan" button (`data-testid="billing-keep-plan-button"`). The pricing page also shows a "Cancel scheduled downgrade" button on the current plan card. Both call `changePlan({ targetPriceId: currentPriceId })` which returns `changeType: "pending_change_cleared"` and releases the Stripe subscription schedule.

**Example:**
```typescript
// After triggering downgrade, cancel it via billing page
await billingPage.goto();
await expect(billingPage.pendingChangeBanner).toBeVisible();
await billingPage.clickKeepPlan(); // clicks data-testid="billing-keep-plan-button"

// Wait for state refresh, then verify banner is gone
await billingPage.goto();
await expect(billingPage.pendingChangeBanner).not.toBeVisible();
await expect(billingPage.planName).toContainText(/pro/i);
```

### Pattern 3: Cancel Subscription via Stripe API (Checkout-Bypass)

**What:** Canceling a subscription at period end by setting `cancel_at_period_end: true` via the Stripe API, bypassing the Customer Portal.

**When to use:** CNCL-01 cancel test.

**How it works:** Subscription cancellation normally happens through the Stripe Customer Portal (a hosted page). Since E2E tests cannot automate portal interactions, the test directly calls `stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })`. This triggers a `customer.subscription.updated` webhook which calls `handleSubscriptionWebhook`. The re-fetch from Stripe sees `cancel_at_period_end: true` and syncs to Convex. The billing page then shows "Expires on" instead of "Renews on" because `getSubscriptionDetails` returns `cancelAtPeriodEnd: true`.

**Example:**
```typescript
// Cancel via Stripe API
await stripeClient.subscriptions.update(subscriptionId, {
  cancel_at_period_end: true,
});

// Wait for Convex webhook processing -- no dedicated waiter needed,
// we can poll the billing snapshot or just reload the billing page
// The billing page fetches live details from Stripe via getSubscriptionDetails
await billingPage.goto();
await expect(billingPage.renewalDate).toContainText(/expires on/i);
```

**Important:** The billing page calls `getSubscriptionDetails` which fetches live data from Stripe, so even if the webhook hasn't fully processed, the UI will show the correct state after a page load. However, waiting for the webhook ensures Convex state is consistent.

### Pattern 4: Credit Topup via Checkout-Bypass (PaymentIntent Direct)

**What:** Purchasing credits by creating a PaymentIntent directly via the Stripe API instead of going through Stripe Checkout.

**When to use:** CRED-04 credit topup test.

**How it works:** The normal topup flow creates a Stripe Checkout session in `mode: "payment"` with metadata `{ billingType: "credit_topup", credits: "10000", userId: convexId, ... }`. When payment succeeds, the `payment_intent.succeeded` webhook calls `grantPurchasedCreditsFromPaymentIntent` which reads the metadata and grants credits. For checkout-bypass, the test can:

1. Create a Stripe Customer (or reuse the subscription customer)
2. Attach a test payment method (already have `attachTestPaymentMethod` helper)
3. Create a PaymentIntent with the `credit_topup` metadata
4. Confirm the PaymentIntent (auto-succeeds with test card)
5. Wait for the `payment_intent.succeeded` webhook to process

**Example:**
```typescript
// Create PaymentIntent with topup metadata
const paymentIntent = await stripeClient.paymentIntents.create({
  amount: 100, // $1.00 for 10,000 credits at default rate
  currency: "usd",
  customer: customerId,
  payment_method: paymentMethodId,
  metadata: {
    billingType: "credit_topup",
    userId: webhookWaiter.userId,
    credits: "10000",
    bundleKey: "credits_10000",
    amountCents: "100",
    creditsPerUsd: "10000",
  },
  confirm: true,
  off_session: true,
});
```

**Key detail:** A new `createTopupBypass()` helper function should be added to `stripe-helpers.ts` to encapsulate this pattern, similar to `createSubscriptionBypass()`.

### Pattern 5: Free Credit Cap Detection

**What:** Verifying that a fresh free user sees the credit cap banner.

**When to use:** CRED-05 free credit cap test.

**How it works:** In `convex/lib/constants.ts`, the free plan's `freeCreditCap` is `FREE_SIGNUP_CREDIT_GRANT = 2,000`. In `convex/lib/userCreation.ts`, `createUserWithDefaults()` grants exactly 2,000 free credits to new users. The billing page checks `isFreeCapReached = creditBalance.free >= freeCreditCap` and renders `data-testid="billing-credit-cap-banner"` when true. Since a fresh free user starts at exactly the cap, the banner should be visible immediately without any additional setup.

**Example:**
```typescript
// A fresh free user already has 2,000 free credits = free cap of 2,000
await billingPage.goto();
await expect(billingPage.creditCapBanner).toBeVisible();
```

**Caveat:** The cap check uses `creditBalance.free >= freeCreditCap`. The `freeBalance` field tracks free credits separately from paid credits. Since signup credits go to `freeBalance`, and the cap for free plan is 2,000, the condition `2000 >= 2000` is true. The `creditsFeatureFlags.enabled` feature flag must also be true for the banner to render.

### Pattern 6: Pro-Rata Credit Calculation Verification

**What:** Calculating expected pro-rata credits from Stripe subscription timestamps and comparing against displayed balance.

**When to use:** CRED-03 pro-rata upgrade credits test.

**How it works:** After subscribing to Go via checkout-bypass, the test retrieves the subscription from Stripe to get `current_period_start` and `current_period_end` timestamps. After upgrading to Pro (via pricing page), the test calculates:
```
remainingRatio = (periodEnd - now) / (periodEnd - periodStart)
creditDelta = 15,000 - 3,000 = 12,000
expectedProRataCredits = floor(remainingRatio * creditDelta)
expectedTotal = 2,000 (free) + 3,000 (Go grant) + expectedProRataCredits
```

The test then asserts the displayed balance is within +-1 of the expected total. The small tolerance accounts for millisecond differences between the test's calculation and the server's calculation.

**Example:**
```typescript
// After upgrade, retrieve subscription timestamps
const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);
const periodStart = subscription.current_period_start * 1000;
const periodEnd = subscription.current_period_end * 1000;
const now = Date.now();
const remainingRatio = (periodEnd - now) / (periodEnd - periodStart);
const expectedProRata = Math.floor(remainingRatio * 12_000);
const expectedTotal = 2_000 + 3_000 + expectedProRata;

const credits = await billingPage.getCreditBalance();
expect(credits).toBeGreaterThanOrEqual(expectedTotal - 1);
expect(credits).toBeLessThanOrEqual(expectedTotal + 1);
```

### Anti-Patterns to Avoid

- **Asserting exact dates in banners:** Pending-change and expiry dates depend on billing cycle timing. Assert text patterns ("Expires on", "Scheduled") not specific dates.
- **Trying to automate Stripe Customer Portal for cancellation:** Portal is a Stripe-hosted page -- use API bypass (`cancel_at_period_end: true`) instead.
- **Trying to automate Stripe Checkout for credit topup:** Use PaymentIntent API bypass with topup metadata instead.
- **Hardcoding pro-rata credit amounts:** Calculate expected value at test time from Stripe timestamps. The amount depends on when in the billing cycle the test runs.
- **Assuming free credit cap requires setup:** A fresh free user already hits the cap (2,000 free credits = 2,000 cap). No extra work needed.
- **Using `page.waitForTimeout()` for webhook processing:** Always use `webhookWaiter.waitForCondition()` patterns.
- **Forgetting that `getSubscriptionDetails` fetches live from Stripe:** The billing page calls a Convex action that re-fetches from the Stripe API. This means state is fresh even if webhook processing is slow. But the page needs to be reloaded or navigated to after the Stripe API call.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Downgrade trigger in tests | Direct API calls to `changePlan` | Click pricing page button `pricingPage.clickSubscribe("go")` | Tests should exercise the real UI flow; the pricing page component handles the changePlan call |
| Subscription cancellation | Stripe Customer Portal automation | `stripe.subscriptions.update(id, { cancel_at_period_end: true })` | Portal is hosted by Stripe and cannot be automated; API bypass produces same webhook result |
| Credit topup purchase | Stripe Checkout automation | Direct PaymentIntent creation with `credit_topup` metadata | Checkout page is hosted by Stripe; PaymentIntent bypass triggers same `payment_intent.succeeded` webhook |
| Pro-rata credit verification | Hardcoded expected values | Calculate from Stripe subscription `current_period_start/end` timestamps | Amount varies with billing cycle timing; must calculate at test time |
| Waiting for credit updates | `page.waitForTimeout()` | `webhookWaiter.waitForCreditBalance()` | Polling with timeout is reliable; fixed delays are either too short or too long |

**Key insight:** Phase 9 specs need two new checkout-bypass patterns beyond Phase 8: (1) subscription cancellation via API instead of portal, and (2) credit topup via PaymentIntent instead of Checkout. Both follow the same principle as the subscription bypass from Phase 8 -- direct API calls that trigger the same webhooks as the real flow.

## Common Pitfalls

### Pitfall 1: Downgrade Has No Confirmation Dialog
**What goes wrong:** Test waits for a confirmation dialog after clicking downgrade, but none appears.
**Why it happens:** The `Pricing` component's `handleSubscribe()` only shows the `UpgradeConfirmationDialog` for upgrades (`isUpgrade === true`). Downgrades call `changePlan()` directly without a dialog.
**How to avoid:** After clicking the Go plan button, do NOT wait for a dialog. Instead, wait for the pricing page state to refresh (the scheduled badge appears, the downgrade button changes).
**Warning signs:** Test times out waiting for `pricingPage.upgradeConfirmButton` which never appears.

### Pitfall 2: Pending-Change Banner Requires Subscription Details Fetch
**What goes wrong:** After downgrade, the billing page shows the plan but no pending-change banner.
**Why it happens:** The billing page renders the pending-change banner based on `details?.hasPendingChange` which comes from `getSubscriptionDetails()`. This is an async action call that fetches from Stripe. On first load, the details may not yet include the schedule information. The billing page calls `getSubscriptionDetails` in a `useEffect` triggered by the subscription changing, but the Convex subscription record may not yet reflect the schedule.
**How to avoid:** After triggering the downgrade, wait briefly for the changePlan action to complete (it's called synchronously from the UI), then reload the billing page. The billing page's `getSubscriptionDetails` action queries Stripe directly (with `expand: ["schedule"]`), so it will see the pending schedule.
**Warning signs:** Banner appears on second page load but not first.

### Pitfall 3: Cancel Subscription Webhook Timing
**What goes wrong:** After calling `stripe.subscriptions.update(id, { cancel_at_period_end: true })`, the billing page still shows "Renews on".
**Why it happens:** The Stripe API call triggers a `customer.subscription.updated` webhook. The webhook handler (`handleSubscriptionWebhook`) re-fetches from Stripe and syncs to Convex. But the billing page's `getSubscriptionDetails` action fetches directly from Stripe, so it should show the correct state even before the webhook is processed.
**How to avoid:** After the Stripe API call, navigate to the billing page (or reload it). The `getSubscriptionDetails` action will fetch fresh data from Stripe. If the test needs to verify Convex state too, use `webhookWaiter` to poll for the `cancelAtPeriodEnd` flag.
**Warning signs:** "Renews on" appears briefly before switching to "Expires on" on reload.

### Pitfall 4: Credit Topup PaymentIntent Metadata Must Match Exactly
**What goes wrong:** PaymentIntent created via API but credits are not granted.
**Why it happens:** `grantPurchasedCreditsFromPaymentIntent` checks `metadata.billingType !== "credit_topup"` and returns `outcome: "ignored_non_topup"` if it doesn't match. It also validates `metadata.credits` is a positive integer.
**How to avoid:** Include all required metadata fields: `billingType: "credit_topup"`, `userId: convexUserId`, `credits: "10000"` (string), `bundleKey`, `amountCents`, `creditsPerUsd`. Match the exact format from `createTopupCheckoutSession` in `convex/credits/actions.ts`.
**Warning signs:** Webhook processes successfully but credits don't increase; logs show "ignored_non_topup".

### Pitfall 5: Free Credit Cap Already Reached on Fresh User
**What goes wrong:** Test tries to "set up" a user at the credit cap, but the user already starts there.
**Why it happens:** `createUserWithDefaults` grants `FREE_SIGNUP_CREDIT_GRANT = 2,000` free credits, and `getFreeCreditCapForPlan("free") = 2,000`. The condition `freeBalance >= freeCreditCap` is `2000 >= 2000 = true` immediately.
**How to avoid:** The CRED-05 test needs no special setup. Just create a fresh free user and verify the cap banner is visible. No need to consume credits, purchase topups, or manipulate state.
**Warning signs:** Unnecessary test complexity to reach a state that already exists.

### Pitfall 6: Pro-Rata Credit Timing Race
**What goes wrong:** Test calculates expected pro-rata credits at a different time than the server, resulting in a mismatch greater than +-1.
**Why it happens:** The `grantUpgradeProRataCredits` mutation uses `Date.now()` at mutation time. The test calculates using `Date.now()` at a different moment. If significant time passes between the upgrade action and the test's calculation (due to webhook processing time), the results may differ.
**How to avoid:** Calculate the expected pro-rata value AFTER the upgrade completes (after `webhookWaiter.waitForSubscriptionPlan("pro")`), as close to the server's grant time as possible. Use a tolerance of +-2 credits to account for the timing gap. The `remainingRatio` changes slowly (a few seconds out of a ~30-day period is negligible), so even a 30-second gap should produce at most +-1 credit difference.
**Warning signs:** Assertions fail by 1-2 credits; passing on retry.

### Pitfall 7: Feature Flags for Credits
**What goes wrong:** Credit cap banner or topup section not visible despite correct state.
**Why it happens:** The billing page checks `creditsFeatureFlags.enabled` before rendering credit UI and `creditsFeatureFlags.topupsEnabled` for the topup section. These are controlled by environment variables `NEXT_PUBLIC_CREDITS_ENABLED` and `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`.
**How to avoid:** Ensure the E2E test environment has these feature flags enabled. They should already be set in the test environment configuration from Phase 7 infrastructure.
**Warning signs:** Credit balance card or cap banner missing; no errors in console.

## Code Examples

### Downgrade Test: Pro to Go

```typescript
import { test, expect } from "../fixtures";
import { createSubscriptionBypass, cleanupStripeCustomer } from "../stripe-helpers";

test.describe("Downgrade: Pro to Go", () => {
  test("downgrade shows pending-change banner and scheduled badge", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

    // 1. Subscribe to Pro via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: proPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // 2. Navigate to pricing and click Go (downgrade)
    await pricingPage.goto();
    // Verify Pro is current before downgrading
    const proCard = pricingPage.planCard("pro");
    await expect(proCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();
    await pricingPage.clickSubscribe("go"); // calls changePlan directly, no dialog

    // 3. Wait for state to settle, then check pricing page
    // The scheduled badge should appear on Go card
    await pricingPage.goto();
    await expect(pricingPage.scheduledBadge).toBeVisible();

    // 4. Assert billing page shows pending-change banner
    await billingPage.goto();
    await expect(billingPage.pendingChangeBanner).toBeVisible();

    // 5. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
```

### Cancel Scheduled Downgrade Test

```typescript
test("cancel scheduled downgrade restores Pro as active plan", async ({
  clerkUser,
  stripeClient,
  webhookWaiter,
  billingPage,
  pricingPage,
}) => {
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID!;

  // 1. Subscribe to Pro
  const { customerId } = await createSubscriptionBypass({
    stripe: stripeClient,
    email: clerkUser.email,
    userId: webhookWaiter.userId,
    priceId: proPriceId,
  });
  await webhookWaiter.waitForSubscriptionPlan("pro");

  // 2. Trigger downgrade to Go
  await pricingPage.goto();
  await pricingPage.clickSubscribe("go");

  // 3. Verify pending-change banner appears
  await billingPage.goto();
  await expect(billingPage.pendingChangeBanner).toBeVisible();

  // 4. Cancel the downgrade via "Keep current plan" button
  await billingPage.clickKeepPlan();

  // 5. Verify banner disappears and Pro is still active
  await billingPage.goto();
  await expect(billingPage.pendingChangeBanner).not.toBeVisible();
  await expect(billingPage.planName).toContainText(/pro/i);

  // 6. Cleanup
  await cleanupStripeCustomer({ stripe: stripeClient, customerId });
});
```

### Cancel Subscription Test

```typescript
import { test, expect } from "../fixtures";
import { createSubscriptionBypass, cleanupStripeCustomer } from "../stripe-helpers";

test.describe("Cancel Subscription", () => {
  test("cancel subscription shows 'Expires on' instead of 'Renews on'", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // 1. Subscribe to Go
    const { customerId, subscriptionId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter.userId,
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");

    // 2. Cancel subscription via Stripe API (bypass portal)
    await stripeClient.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // 3. Navigate to billing page (getSubscriptionDetails fetches live from Stripe)
    await billingPage.goto();
    await expect(billingPage.renewalDate).toContainText(/expires on/i);

    // 4. Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
```

### Free Signup Credits Test

```typescript
test("free user sees 2,000 signup credits on billing page", async ({
  billingPage,
}) => {
  // A fresh user created by the billing fixture already has 2,000 free credits
  await billingPage.goto();
  const credits = await billingPage.getCreditBalance();
  expect(credits).toBe(2_000);
});
```

### Credit Topup Bypass Pattern

```typescript
// Helper function (to add to stripe-helpers.ts)
async function createTopupBypass(args: {
  stripe: Stripe;
  customerId: string;
  paymentMethodId: string;
  userId: string;
  credits: number;
  amountCents: number;
}): Promise<{ paymentIntentId: string }> {
  const pi = await args.stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: "usd",
    customer: args.customerId,
    payment_method: args.paymentMethodId,
    metadata: {
      billingType: "credit_topup",
      userId: args.userId,
      credits: String(args.credits),
      bundleKey: `credits_${args.credits}`,
      amountCents: String(args.amountCents),
      creditsPerUsd: "10000",
    },
    confirm: true,
    off_session: true,
  });
  return { paymentIntentId: pi.id };
}
```

### Free Credit Cap Banner Test

```typescript
test("free user at credit cap sees cap banner", async ({
  billingPage,
}) => {
  // Fresh free user has freeBalance = 2,000 and freeCreditCap = 2,000
  // The cap banner should be visible immediately
  await billingPage.goto();
  await expect(billingPage.creditCapBanner).toBeVisible();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Portal automation for cancel | API bypass: `cancel_at_period_end: true` | Phase 9 | Avoids Stripe-hosted portal automation |
| Stripe Checkout for topup | PaymentIntent API bypass | Phase 9 | Same webhook path, avoids Checkout automation |
| Hardcoded pro-rata values | Runtime calculation from Stripe timestamps | Phase 9 | Handles variable billing cycle timing |
| Free cap setup via API | No setup needed (fresh user = at cap) | Phase 9 | Simplifies CRED-05 test |

## Open Questions

1. **Downgrade Page State Refresh Timing**
   - What we know: After calling `changePlan` for a downgrade, the pricing page calls `getSubscriptionDetails` to refresh. The changePlan action is called synchronously from the button click handler.
   - What's unclear: Does the pricing page state update reactively after `changePlan` returns, or does the page need to be reloaded/navigated to see the "Scheduled" badge? The `handleSubscribe` function calls `getSubscriptionDetails` after `changePlan` and updates `subscriptionDetails` state, but timing of re-render vs test assertion is uncertain.
   - Recommendation: After clicking the downgrade button, wait briefly and re-navigate to the pricing page to ensure fresh state. If the pricing page updates reactively, the re-navigation is harmless. Confidence: MEDIUM -- needs validation in test execution.

2. **WebhookWaiter Extension for Cancel and Schedule State**
   - What we know: `WebhookWaiter` has `waitForSubscriptionPlan()` and `waitForCreditBalance()`. The billing snapshot includes `cancelAtPeriodEnd` in the subscription data.
   - What's unclear: Is a new waiter method needed for cancellation state (e.g., `waitForCancellation()`) or can the existing `waitForCondition` pattern be used directly?
   - Recommendation: The `getBillingSnapshot()` method already returns `cancelAtPeriodEnd`. The test can poll using a custom condition via `waitForCondition()` if needed, or rely on the billing page's live fetch from Stripe (which makes the UI the source of truth). For simplicity, the cancel test can just reload the billing page after the API call -- `getSubscriptionDetails` queries Stripe directly. Confidence: HIGH -- the billing page's live Stripe fetch makes the webhook wait optional for cancel tests.

3. **Credit Topup Bypass: PaymentIntent vs Checkout Session Simulation**
   - What we know: The topup flow uses Stripe Checkout (hosted). The `payment_intent.succeeded` webhook handler processes topup grants based on metadata.
   - What's unclear: Will creating a PaymentIntent directly (without a Checkout session) trigger the same webhook? Stripe fires `payment_intent.succeeded` regardless of how the PaymentIntent was created.
   - Recommendation: Use direct PaymentIntent creation with `confirm: true`. This is the standard pattern for bypassing Stripe Checkout in test environments. The webhook handler only checks `metadata.billingType === "credit_topup"` -- it doesn't verify the PaymentIntent came from a Checkout session. Confidence: HIGH -- Stripe fires `payment_intent.succeeded` for all confirmed PaymentIntents.

## Sources

### Primary (HIGH confidence)
- **Codebase: `e2e/billing/fixtures.ts`** -- Phase 7 billing fixture providing clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage
- **Codebase: `e2e/billing/stripe-helpers.ts`** -- `createSubscriptionBypass()`, `cleanupStripeCustomer()`, `attachTestPaymentMethod()`
- **Codebase: `e2e/billing/webhook-waiter.ts`** -- `WebhookWaiter` with `waitForSubscriptionPlan()`, `waitForCreditBalance()`, `getBillingSnapshot()`
- **Codebase: `e2e/billing/pages/billing-page.ts`** -- `BillingPage` POM with `pendingChangeBanner`, `keepPlanButton`, `creditCapBanner`, `renewalDate`, `getCreditBalance()`
- **Codebase: `e2e/billing/pages/pricing-page.ts`** -- `PricingPage` POM with `scheduledBadge`, `clickSubscribe()`, `planCard()`
- **Codebase: `e2e/billing/specs/subscribe.spec.ts`** -- Phase 8 subscribe spec (pattern reference)
- **Codebase: `e2e/billing/specs/upgrade.spec.ts`** -- Phase 8 upgrade spec (pattern reference)
- **Codebase: `convex/subscriptions/actions.ts`** -- `changePlan` action with downgrade scheduling, `getSubscriptionDetails` with `hasPendingChange`, `cancelAtPeriodEnd`
- **Codebase: `convex/credits/actions.ts`** -- `createTopupCheckoutSession` with metadata format for topup bypass
- **Codebase: `convex/credits/internal.ts`** -- `grantUpgradeProRataCredits` (pro-rata calculation), `grantPurchasedCreditsFromPaymentIntent` (topup grant)
- **Codebase: `convex/lib/constants.ts`** -- `FREE_SIGNUP_CREDIT_GRANT = 2,000`, `PLAN_CONFIG` with `creditsPerMonth` and `freeCreditCap`
- **Codebase: `convex/lib/userCreation.ts`** -- `createUserWithDefaults()` grants signup credits at user creation
- **Codebase: `convex/lib/freeCredits.ts`** -- `applyTierFreeCreditCap()` and `getFreeCreditCapForPlan()`
- **Codebase: `convex/lib/creditTopups.ts`** -- `CREDIT_TOPUP_BUNDLES`, `convertCreditsToAmountCents()`
- **Codebase: `convex/http.ts`** -- `payment_intent.succeeded` webhook handler calls `grantPurchasedCreditsFromPaymentIntent`
- **Codebase: `convex/subscriptions/lib/schedulePlanning.ts`** -- `buildDowngradeSchedulePhases()`, `findPendingScheduleChange()`
- **Codebase: `convex/subscriptions/lib/cancellation.ts`** -- `isSubscriptionScheduledToCancel()`
- **Codebase: `app/settings/billing/page.tsx`** -- Billing page rendering logic for pending-change banner, "Expires on" vs "Renews on", credit cap banner
- **Codebase: `components/Pricing.tsx`** -- Pricing page with downgrade button logic, scheduled badge, keep-plan button

### Secondary (MEDIUM confidence)
- **Phase 8 Research:** `08-RESEARCH.md` -- Infrastructure patterns, credit accounting documentation, Stripe cleanup patterns

### Tertiary (LOW confidence)
- None. All findings verified directly against codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and configured; Phase 7/8 infrastructure is complete
- Architecture: HIGH -- all `data-testid` attributes already exist in components; page object methods already cover required interactions; only new pattern is PaymentIntent topup bypass
- Pitfalls: HIGH -- downgrade-no-dialog behavior verified from `Pricing.tsx` `handleSubscribe()` source; credit cap verified from `constants.ts` values and `userCreation.ts` grant logic; pro-rata calculation verified from `credits/internal.ts` `grantUpgradeProRataCredits` source

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- Phase 7/8 infrastructure is complete and pinned)
