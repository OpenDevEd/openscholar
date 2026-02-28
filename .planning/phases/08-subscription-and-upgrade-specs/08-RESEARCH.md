# Phase 8: Subscription and Upgrade Specs - Research

**Researched:** 2026-02-28
**Domain:** Playwright E2E test specs for subscription creation (free-to-Go, free-to-Pro) and plan upgrade (Go-to-Pro) billing flows
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Two spec files: `e2e/billing/specs/subscribe.spec.ts` and `e2e/billing/specs/upgrade.spec.ts`
- Use `describe` + `test` blocks (not flat `test()` calls)
- Each test is fully independent -- gets its own fresh Clerk user via the billing fixture
- No shared state or sequential coupling between tests
- After subscribing: verify plan name, credit balance (total only), AND active status badge on billing page
- After subscribing: also navigate to pricing page and verify "Current Plan" badge appears on the subscribed plan
- Credit balance checks use total credits only (no free vs paid breakdown)
- After upgrade: verify credit balance updated to reflect Pro-level credits
- Verify the upgrade confirmation dialog appears and is visible
- Verify dialog mentions plan names (upgrading from Go to Pro)
- Do NOT assert exact proration dollar amounts (volatile, depends on subscription timing)
- Click confirm and verify outcome on billing page
- Upgrade test is fully self-contained: creates fresh user, subscribes to Go via checkout-bypass, waits for sync, then performs in-app upgrade to Pro
- After upgrade, verify pricing page also updates ("Current Plan" badge moves from Go to Pro)
- 08-01: Subscribe specs (`subscribe.spec.ts`) -- Go and Pro subscription tests
- 08-02: Upgrade spec (`upgrade.spec.ts`) -- Go-to-Pro upgrade test
- Both plans run in parallel (wave 1) -- no dependencies between them
- All tests run against real Stripe sandbox (not mocked)

### Claude's Discretion
- Exact `describe` block naming and test descriptions
- Wait timing between checkout-bypass and UI assertions (use webhook waiter patterns from Phase 7)
- Any additional page object methods needed beyond what Phase 7 provides
- Error handling for flaky network conditions in test setup

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUB-01 | User can subscribe from free to Go plan via checkout-bypass pattern and see plan on billing page | All infrastructure exists: `createSubscriptionBypass()` in `e2e/billing/stripe-helpers.ts` creates subscription via Stripe API, `WebhookWaiter.waitForSubscriptionPlan("go")` polls Convex until sync, `BillingPage.getPlanName()` and `getStatusBadgeText()` assert UI state. Go price ID from env `STRIPE_GO_PRICE_ID`. Plan shows as "go Plan" (capitalized by `t("planLabel", { plan: displayPlan })`). |
| SUB-02 | User can subscribe from free to Pro plan via checkout-bypass pattern and see plan on billing page | Identical pattern to SUB-01 with Pro price ID from env `STRIPE_PRO_PRICE_ID` and `waitForSubscriptionPlan("pro")`. Pro plan grants 15,000 credits per month. |
| PLAN-01 | User can upgrade from Go to Pro via in-app confirmation dialog with proration preview | Upgrade flow: navigate to `/pricing`, click Pro plan button (`pricingPage.clickSubscribe("pro")`), which triggers `getUpgradePreview` action that populates the `UpgradeConfirmationDialog`. Dialog has `data-testid="upgrade-confirm-button"` and `data-testid="upgrade-cancel-button"`. Clicking confirm calls `changePlan` action with `proration_behavior: "always_invoice"`. Dialog shows `currentPlan` and `targetPlan` text (capitalized). After confirm, subscription updates immediately and pro-rata credits are granted via `grantUpgradeProRataCredits`. |
| CRED-02 | User receives correct monthly credits on subscription (3,000 Go / 15,000 Pro) | Credit grants happen server-side when Stripe webhook processes the `invoice.paid` event. `PLAN_CONFIG` in `convex/lib/constants.ts` defines `go: { creditsPerMonth: 3_000 }` and `pro: { creditsPerMonth: 15_000 }`. WebhookWaiter's `waitForCreditBalance()` polls until balance matches. BillingPage's `getCreditBalance()` strips non-digit chars and parses int from `data-testid="billing-credit-balance"`. Note: new users also get `FREE_SIGNUP_CREDIT_GRANT = 2_000` free credits, so total after Go subscription = 2,000 + 3,000 = 5,000 and after Pro = 2,000 + 15,000 = 17,000. |
</phase_requirements>

## Summary

Phase 8 writes the E2E test spec files that consume the Phase 7 infrastructure (billing fixture, page objects, Stripe helpers, webhook waiter). The entire Phase 7 test stack is already built and available: `e2e/billing/fixtures.ts` provides `{ clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage }` to each test. The specs directory (`e2e/billing/specs/`) needs to be created.

The subscribe specs (`subscribe.spec.ts`) will contain a `describe` block with two tests: one subscribing to Go and one to Pro. Each test creates a fresh user via the billing fixture, calls `createSubscriptionBypass()` with the appropriate price ID and the user's Convex ID (obtained from `webhookWaiter`), waits for Convex state convergence, then asserts plan name, active status badge, credit balance, and pricing page "Current Plan" badge. The critical detail is that credit balance assertions must account for the free signup credit grant (2,000 credits) plus the subscription grant (3,000 or 15,000).

The upgrade spec (`upgrade.spec.ts`) is fully self-contained. It subscribes a fresh user to Go via checkout-bypass, waits for sync, navigates to the pricing page, clicks "Upgrade to Pro", verifies the upgrade confirmation dialog is visible with plan names, clicks confirm, waits for Convex sync, then asserts Pro plan on billing page with updated credits and "Current Plan" badge on pricing page.

**Primary recommendation:** Each spec file should import `{ test, expect }` from `../fixtures` and use the pre-built fixture destructuring. Tests should be 10-15 lines of test body, with the infrastructure doing the heavy lifting.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@playwright/test` | 1.58.2 | Test runner, assertions, describe/test blocks | Already installed; billing project configured in `playwright.config.ts` |
| Billing fixture | N/A | `test.extend` providing clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage | Built in Phase 7 at `e2e/billing/fixtures.ts` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `stripe` | 20.3.0 | `createSubscriptionBypass()` for test setup | Every subscription test (checkout-bypass pattern) |
| `convex` CLI | 1.31.7 | WebhookWaiter polls Convex state | After Stripe API calls, before UI assertions |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure

```
e2e/
  billing/
    fixtures.ts          # Phase 7 -- billing test fixture
    webhook-waiter.ts    # Phase 7 -- Convex state polling
    stripe-helpers.ts    # Phase 7 -- checkout-bypass, cleanup
    pages/
      billing-page.ts    # Phase 7 -- BillingPage POM
      pricing-page.ts    # Phase 7 -- PricingPage POM
    specs/               # Phase 8 -- NEW
      subscribe.spec.ts  # SUB-01, SUB-02, CRED-02
      upgrade.spec.ts    # PLAN-01, CRED-02
```

### Pattern 1: Subscribe Spec Structure

**What:** A describe block containing independent subscription tests, each using the billing fixture.

**When to use:** Both subscribe tests (Go and Pro).

**Example:**
```typescript
// e2e/billing/specs/subscribe.spec.ts
import { test, expect } from "../fixtures";
import { createSubscriptionBypass } from "../stripe-helpers";

test.describe("Subscription: Free to Paid", () => {
  test("subscribe to Go plan shows Go plan with 3,000 credits", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // Subscribe via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter["convexUserId"], // Access the Convex user ID
      priceId: goPriceId,
    });

    // Wait for Convex to process the webhook
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5000);

    // Assert billing page
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/go/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(5000); // 2,000 free + 3,000 Go

    // Assert pricing page
    await pricingPage.goto();
    await expect(pricingPage.currentBadge).toBeVisible();
    // Verify badge is on Go plan card
    const goPlanCard = pricingPage.planCard("go");
    await expect(goPlanCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();
  });
});
```

### Pattern 2: Upgrade Spec Structure

**What:** A self-contained upgrade test that sets up Go subscription, then triggers in-app upgrade to Pro.

**When to use:** The upgrade test (Go to Pro).

**Example:**
```typescript
// e2e/billing/specs/upgrade.spec.ts
import { test, expect } from "../fixtures";
import { createSubscriptionBypass } from "../stripe-helpers";

test.describe("Upgrade: Go to Pro", () => {
  test("upgrade from Go to Pro via confirmation dialog", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // Step 1: Subscribe to Go via checkout-bypass
    await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter["convexUserId"],
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");

    // Step 2: Navigate to pricing page and trigger upgrade
    await pricingPage.goto();
    await pricingPage.clickSubscribe("pro");

    // Step 3: Verify upgrade confirmation dialog
    await expect(pricingPage.upgradeConfirmButton).toBeVisible();
    // Dialog shows plan names -- not exact dollar amounts
    // Dialog content includes "currentPlan" and "targetPlan" text

    // Step 4: Confirm upgrade
    await pricingPage.upgradeConfirmButton.click();

    // Step 5: Wait for Convex to process the upgrade
    await webhookWaiter.waitForSubscriptionPlan("pro");
    await webhookWaiter.waitForCreditBalance((total) => total >= 17000);

    // Step 6: Assert billing page shows Pro
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/pro/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(17000); // 2,000 free + 15,000 Pro

    // Step 7: Assert pricing page shows Pro as current
    await pricingPage.goto();
    const proPlanCard = pricingPage.planCard("pro");
    await expect(proPlanCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();
  });
});
```

### Pattern 3: Accessing the Convex User ID from WebhookWaiter

**What:** The `WebhookWaiter` constructor receives the `convexUserId` as a private field. The `createSubscriptionBypass()` helper needs this ID for the `userId` metadata that links the Stripe customer to the Convex user.

**When to use:** Every test that calls `createSubscriptionBypass()`.

**How to access:** The `convexUserId` is a private field on `WebhookWaiter`. Two approaches:
1. Access via bracket notation: `webhookWaiter["convexUserId"]` (TypeScript allows this for testing)
2. Add a public getter to `WebhookWaiter` (cleaner, but modifies Phase 7 code)

**Recommendation:** Add a public `userId` getter to `WebhookWaiter` for clean access:
```typescript
// In webhook-waiter.ts
get userId(): string {
  return this.convexUserId;
}
```

### Pattern 4: Credit Balance Accounting

**What:** New users receive `FREE_SIGNUP_CREDIT_GRANT = 2,000` free credits on account creation. Subscription grants add to this.

**When to use:** Every credit balance assertion.

**Key values:**
| Scenario | Free Credits | Subscription Credits | Expected Total (minimum) |
|----------|-------------|---------------------|-------------------------|
| Free to Go | 2,000 | 3,000 | 5,000 |
| Free to Pro | 2,000 | 15,000 | 17,000 |
| Go to Pro (upgrade) | 2,000 | 15,000 + pro-rata | 17,000 (at least) |

**Critical detail:** The upgrade test (Go to Pro) replaces the subscription-level credits. After upgrade:
- The Go subscription already granted 3,000 credits
- The upgrade grants pro-rata credits for the remaining period (variable amount)
- The new Pro subscription grants 15,000 credits on the next invoice
- For the immediate upgrade, the credit balance will be: 2,000 (free) + 3,000 (original Go grant) + pro-rata upgrade credits
- Use `>=` assertions, not exact equality, because pro-rata amounts vary with timing

**Recommendation for upgrade credit assertion:** After Go-to-Pro upgrade, wait for credit balance to exceed the original Go balance. The exact amount depends on timing, but it will always be greater than the initial Go grant (5,000). Use a predicate like `total > 5000` rather than asserting an exact number. The pro-rata credit grant is calculated as `floor(remainingRatio * creditDelta)` where `creditDelta = 15,000 - 3,000 = 12,000`.

### Anti-Patterns to Avoid

- **Asserting exact credit amounts after upgrade:** Pro-rata credits depend on the time elapsed within the billing period. Use `>=` or range assertions.
- **Asserting exact proration dollar amounts in the upgrade dialog:** The proration charge varies with subscription timing. Per locked decision, verify the dialog is visible and mentions plan names, but do NOT assert dollar amounts.
- **Sharing state between subscribe and upgrade tests:** Each test must be fully independent. The upgrade test creates its own user and Go subscription from scratch.
- **Navigating to billing page before webhook processing completes:** Always call `webhookWaiter.waitForSubscriptionPlan()` before navigating to the billing page. The billing page reactively updates from Convex state, but initial load timing can race with webhook processing.
- **Forgetting Stripe cleanup after checkout-bypass:** The billing fixture handles Clerk user deletion and Convex state reset, but Stripe customer/subscription cleanup must also happen. The fixture teardown calls `cleanupStripeCustomer()` -- but tests using `createSubscriptionBypass()` need to ensure the `customerId` is tracked for cleanup. This is handled by the fixture's webhookWaiter teardown which calls `resetBillingState()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Subscription creation in tests | Manual Stripe API calls inline in tests | `createSubscriptionBypass()` from `stripe-helpers.ts` | Handles customer creation, payment method, subscription, and metadata linking in one call |
| Waiting for Convex sync | `page.waitForTimeout()` or sleep() | `webhookWaiter.waitForSubscriptionPlan()` and `waitForCreditBalance()` | Polling with timeout is reliable; fixed delays are either too short (flaky) or too long (slow) |
| Test user lifecycle | Manual Clerk API calls | Billing fixture's `clerkUser` | Handles creation, sign-in, sign-out, and deletion automatically |
| Billing page assertions | Raw CSS/XPath selectors | `BillingPage` POM methods | Encapsulates `data-testid` selectors, handles text parsing, survives refactoring |
| Pricing page interactions | Direct locator construction | `PricingPage` POM methods | Typed plan IDs, button interactions, badge assertions |

**Key insight:** Phase 8 specs should be pure consumer code. Every piece of test infrastructure is already built in Phase 7. If a test is longer than 15-20 lines, something is wrong -- the fixture or page object probably has a method for it.

## Common Pitfalls

### Pitfall 1: Free Signup Credits in Balance Assertions
**What goes wrong:** Test asserts `credits === 3000` for Go plan, but actual balance is `5000` (2,000 free + 3,000 Go).
**Why it happens:** `FREE_SIGNUP_CREDIT_GRANT = 2,000` is granted to every new user on account creation, before any subscription.
**How to avoid:** Always account for the 2,000 free credits in assertions. Go total = 5,000, Pro total = 17,000. Use `>= expectedTotal` not `=== subscriptionCredits`.
**Warning signs:** Credit balance test passes locally if signup credits are already consumed, fails on fresh accounts.

### Pitfall 2: Upgrade Dialog Interaction Timing
**What goes wrong:** Clicking the Pro plan button on the pricing page doesn't open the upgrade dialog.
**Why it happens:** The pricing page must fully load and recognize the user has a Go subscription before showing the "Upgrade to Pro" button. If the button says "Sign in" or "Loading", the click doesn't trigger the upgrade flow.
**How to avoid:** After subscribing to Go and waiting for webhook sync, navigate to the pricing page and wait for the Go plan card to show "Current Plan" badge before clicking the Pro plan button. This confirms the subscription state has settled in the browser.
**Warning signs:** Test sees "Sign in to subscribe" instead of "Upgrade to Pro" on the button.

### Pitfall 3: Upgrade Credits are Pro-Rata, Not Full
**What goes wrong:** Test asserts exact Pro credit amount (15,000) immediately after upgrade, but actual amount is the pro-rata portion.
**Why it happens:** The `changePlan` action calls `grantUpgradeProRataCredits` which calculates `floor(remainingRatio * creditDelta)`. A full 15,000 grant only happens at the next billing cycle's `invoice.paid` webhook.
**How to avoid:** After upgrade, assert that credit balance increased beyond the Go amount (5,000), not that it equals the full Pro amount. The pro-rata grant will be some portion of 12,000 (15,000 - 3,000) based on remaining billing period.
**Warning signs:** Assertion fails with "expected 17000, received 16800" (or similar partial amount).

### Pitfall 4: WebhookWaiter convexUserId Access
**What goes wrong:** `createSubscriptionBypass()` receives `undefined` for `userId`, causing the Stripe customer metadata to be wrong and Convex can't link the subscription.
**Why it happens:** The `convexUserId` field on `WebhookWaiter` is private. Accessing it without a public getter or bracket notation fails silently in TypeScript.
**How to avoid:** Add a public `userId` getter to `WebhookWaiter`, or use `webhookWaiter["convexUserId"]` bracket notation in tests.
**Warning signs:** Subscription appears in Stripe but billing page still shows "Free Plan" after waiting.

### Pitfall 5: Pricing Page Button Text Depends on Auth State
**What goes wrong:** Test clicks the Pro plan button expecting an upgrade dialog, but the page redirects to sign-in or Stripe checkout.
**Why it happens:** The `Pricing` component has complex button logic in `getButtonConfig()`. The "Upgrade to Pro" button only appears when: user is authenticated, has resolved subscription, current plan is below Pro tier, and is entitled.
**How to avoid:** Ensure the user is signed in and the subscription state has fully settled before interacting with the pricing page. After `webhookWaiter.waitForSubscriptionPlan("go")`, navigate to pricing page and verify the Go plan card shows "Current Plan" badge before clicking Pro.
**Warning signs:** Redirect to `/sign-in` or Stripe Checkout URL instead of upgrade dialog.

### Pitfall 6: Stripe Cleanup for Checkout-Bypass Customers
**What goes wrong:** Stripe sandbox accumulates test customers across runs, eventually hitting limits.
**Why it happens:** The billing fixture's `webhookWaiter` teardown calls `resetBillingState()` (Convex-side cleanup), but Stripe-side cleanup requires knowing the `customerId` returned from `createSubscriptionBypass()`.
**How to avoid:** The test should track the `customerId` from `createSubscriptionBypass()` and ensure it's cleaned up. The existing `cleanupStripeCustomer()` helper cancels subscriptions and deletes the customer. Consider adding a `test.afterEach` or extending the fixture teardown.
**Warning signs:** Stripe dashboard shows hundreds of test customers; rate limits hit.

## Code Examples

### Complete Subscribe Test (Go Plan)

```typescript
import { test, expect } from "../fixtures";
import { createSubscriptionBypass, cleanupStripeCustomer } from "../stripe-helpers";

test.describe("Subscription: Free to Paid", () => {
  test("subscribe to Go plan shows Go plan with 3,000 credits", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // Checkout-bypass: create subscription via Stripe API
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter["convexUserId"],
      priceId: goPriceId,
    });

    // Wait for Convex webhook processing
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5000);

    // Verify billing page
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/go/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThanOrEqual(5000);

    // Verify pricing page
    await pricingPage.goto();
    const goCard = pricingPage.planCard("go");
    await expect(goCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();

    // Cleanup Stripe objects
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
```

### Complete Upgrade Test (Go to Pro)

```typescript
import { test, expect } from "../fixtures";
import { createSubscriptionBypass, cleanupStripeCustomer } from "../stripe-helpers";

test.describe("Upgrade: Go to Pro", () => {
  test("upgrade from Go to Pro via confirmation dialog", async ({
    clerkUser,
    stripeClient,
    webhookWaiter,
    billingPage,
    pricingPage,
  }) => {
    const goPriceId = process.env.STRIPE_GO_PRICE_ID!;

    // Step 1: Subscribe to Go via checkout-bypass
    const { customerId } = await createSubscriptionBypass({
      stripe: stripeClient,
      email: clerkUser.email,
      userId: webhookWaiter["convexUserId"],
      priceId: goPriceId,
    });
    await webhookWaiter.waitForSubscriptionPlan("go");
    await webhookWaiter.waitForCreditBalance((total) => total >= 5000);

    // Step 2: Navigate to pricing and verify Go is current
    await pricingPage.goto();
    const goCard = pricingPage.planCard("go");
    await expect(goCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();

    // Step 3: Click "Upgrade to Pro"
    await pricingPage.clickSubscribe("pro");

    // Step 4: Verify upgrade confirmation dialog is visible
    await expect(pricingPage.upgradeConfirmButton).toBeVisible({ timeout: 15_000 });
    // Verify dialog contains plan names (not dollar amounts)
    const dialogContent = pricingPage.page.locator('[role="dialog"]');
    await expect(dialogContent).toContainText(/go/i);
    await expect(dialogContent).toContainText(/pro/i);

    // Step 5: Confirm upgrade
    await pricingPage.upgradeConfirmButton.click();

    // Step 6: Wait for Convex to process the upgrade
    await webhookWaiter.waitForSubscriptionPlan("pro");

    // Step 7: Verify billing page shows Pro
    await billingPage.goto();
    await expect(billingPage.planName).toContainText(/pro/i);
    await expect(billingPage.statusBadge).toContainText(/active/i);

    // Step 8: Verify credits increased beyond Go level
    const credits = await billingPage.getCreditBalance();
    expect(credits).toBeGreaterThan(5000); // Pro-rata credits + original Go credits

    // Step 9: Verify pricing page shows Pro as current
    await pricingPage.goto();
    const proCard = pricingPage.planCard("pro");
    await expect(proCard.locator('[data-testid="pricing-current-badge"]')).toBeVisible();

    // Cleanup
    await cleanupStripeCustomer({ stripe: stripeClient, customerId });
  });
});
```

### WebhookWaiter Public userId Getter (Recommended Addition)

```typescript
// Addition to e2e/billing/webhook-waiter.ts
export class WebhookWaiter {
  constructor(
    private convexUserId: string,
    private defaultTimeoutMs: number = 30_000,
    private intervalMs: number = 2_500,
  ) {}

  /** Public accessor for the Convex user ID, needed by stripe-helpers */
  get userId(): string {
    return this.convexUserId;
  }

  // ... rest of class unchanged
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat `test()` calls | `describe` + `test` blocks | Playwright convention | User decision: use describe blocks for grouping |
| Assert exact credit amounts | Assert `>=` or ranges for credits | Phase 8 decision | Accounts for free signup credits and pro-rata timing |
| Test upgrade via API only | Test upgrade via in-app dialog | Phase 8 decision | Validates full UI flow including proration preview |
| Mock Stripe interactions | Real Stripe sandbox | Project decision | Tests verify actual webhook processing end-to-end |

## Open Questions

1. **Stripe Cleanup Ownership for Checkout-Bypass Customers**
   - What we know: The billing fixture teardown resets Convex state via `webhookWaiter.resetBillingState()` and deletes the Clerk user. But Stripe customers created by `createSubscriptionBypass()` need separate cleanup.
   - What's unclear: Should each test call `cleanupStripeCustomer()` explicitly, or should the fixture be extended to track and clean up Stripe customers automatically?
   - Recommendation: Each test should call `cleanupStripeCustomer()` at the end, passing the `customerId` returned from `createSubscriptionBypass()`. This is explicit and avoids modifying Phase 7 code. If cleanup becomes tedious, a future enhancement could extend the fixture. Confidence: HIGH -- this pattern is proven in `tests/live-billing/support.ts`.

2. **Upgrade Credit Balance Assertion Threshold**
   - What we know: After Go-to-Pro upgrade, credits = 2,000 (free) + 3,000 (Go grant) + floor(remainingRatio * 12,000) (pro-rata). The pro-rata amount depends on when in the billing period the test runs.
   - What's unclear: What's the minimum safe assertion threshold? If the test runs immediately after Go subscription (remainingRatio near 1.0), pro-rata could be close to 12,000. If it runs near period end, it could be near 0.
   - Recommendation: Assert `credits > 5000` (more than Go-level). This is safe regardless of timing. The pro-rata grant will always be at least 0 (if run at exact period end), and the original Go credits (5,000) are always present. A stricter assertion like `>= 5001` confirms at least some pro-rata credits were granted. Confidence: MEDIUM -- depends on test timing, but `> 5000` is safe.

3. **WebhookWaiter Private Field Access**
   - What we know: `createSubscriptionBypass()` needs the Convex user ID, which is stored as a private field on `WebhookWaiter`.
   - What's unclear: Is modifying `WebhookWaiter` to add a public getter within Phase 8 scope, or does it require a Phase 7 amendment?
   - Recommendation: Add a simple `get userId()` getter to `WebhookWaiter`. This is a minor non-breaking change that doesn't alter Phase 7 behavior. It enables Phase 8 tests to access the Convex user ID cleanly. Alternatively, use bracket notation `webhookWaiter["convexUserId"]` without modifying Phase 7 code. Confidence: HIGH -- both approaches work.

## Sources

### Primary (HIGH confidence)
- **Codebase: `e2e/billing/fixtures.ts`** -- Phase 7 billing fixture providing clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage
- **Codebase: `e2e/billing/stripe-helpers.ts`** -- `createSubscriptionBypass()`, `attachTestPaymentMethod()`, `cleanupStripeCustomer()`
- **Codebase: `e2e/billing/webhook-waiter.ts`** -- `WebhookWaiter` class with `waitForSubscriptionPlan()`, `waitForCreditBalance()`, `resetBillingState()`
- **Codebase: `e2e/billing/pages/billing-page.ts`** -- `BillingPage` POM with `getPlanName()`, `getStatusBadgeText()`, `getCreditBalance()`
- **Codebase: `e2e/billing/pages/pricing-page.ts`** -- `PricingPage` POM with `clickSubscribe()`, `currentBadge`, `upgradeConfirmButton`
- **Codebase: `convex/lib/constants.ts`** -- `PLAN_CONFIG` defining creditsPerMonth (go: 3,000, pro: 15,000), `FREE_SIGNUP_CREDIT_GRANT = 2,000`
- **Codebase: `convex/subscriptions/actions.ts`** -- `changePlan` action with upgrade/downgrade logic, `getUpgradePreview` action
- **Codebase: `components/billing/upgrade-confirmation-dialog.tsx`** -- Dialog with `data-testid="upgrade-confirm-button"`, `data-testid="upgrade-cancel-button"`, `data-testid="upgrade-total-charge"`
- **Codebase: `components/Pricing.tsx`** -- Pricing page with plan cards, "Current Plan" badge, upgrade button logic
- **Codebase: `app/settings/billing/page.tsx`** -- Billing settings page with plan display, credit balance, status badge
- **Codebase: `components/billing/credit-balance-card.tsx`** -- Credit balance display with `data-testid="billing-credit-balance"`
- **Codebase: `playwright.config.ts`** -- Billing project config with 180s timeout, `workers: 1`, `locale: en-US`

### Secondary (MEDIUM confidence)
- **Codebase: `tests/live-billing/support.ts`** -- Reference patterns for Stripe helpers, `waitForCondition`, Convex CLI invocation
- **Phase 7 Research:** `07-RESEARCH.md` -- Infrastructure patterns and pitfall documentation

### Tertiary (LOW confidence)
- None. All findings verified directly against codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and configured; Phase 7 infrastructure is complete
- Architecture: HIGH -- spec patterns directly follow Phase 7 fixture API; all data-testid attributes already in place
- Pitfalls: HIGH -- credit accounting edge cases identified from constants.ts; upgrade timing documented from changePlan action source

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- Phase 7 infrastructure is complete and pinned)
