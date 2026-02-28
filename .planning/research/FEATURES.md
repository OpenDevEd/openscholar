# Feature Landscape: E2E Billing Tests

**Domain:** Playwright E2E test suite for SaaS billing flows (Stripe + Clerk + Convex)
**Researched:** 2026-02-28
**Confidence:** HIGH (Stripe official docs, Clerk testing docs, Playwright docs, codebase analysis of existing live-billing tests and UI components)

## Table Stakes

Features that any serious billing E2E test suite must cover. Missing any of these means you shipped billing code with confidence gaps in the most financially sensitive paths.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Subscription creation E2E (free to Go)** | The primary revenue conversion path. If this breaks, no one can subscribe. Must test: click plan on pricing page, navigate to Stripe Checkout, complete payment with test card, return to app, verify plan + status + credits in billing page. | HIGH | Stripe Checkout page automation (iframe card fill), Clerk auth, webhook processing wait |
| **Subscription creation E2E (free to Pro)** | Same flow but for the higher tier. Different price, different credit grant amount. Verifies the pricing page correctly routes to the right price ID. | HIGH | Same as Go, but validates Pro-specific constants (15,000 credits/month, tier 20) |
| **Upgrade E2E (Go to Pro)** | Tests the upgrade dialog with proration preview, payment method display, line items, confirm button, and credit grant. This is the v1.1 feature that has the most moving parts and the highest financial risk. | HIGH | Active Go subscription, upgrade dialog interactions, proration math verification, credit balance assertion |
| **Downgrade E2E (Pro to Go)** | Tests that downgrade schedules correctly via subscription schedule (not immediate). UI must show "Scheduled" badge. Plan must remain Pro until period boundary. | MEDIUM | Active Pro subscription, Stripe subscription schedule, billing page pending-change banner verification |
| **Cancellation E2E** | Tests that cancelling via customer portal marks the subscription for end-of-period cancellation. Billing page must show "Expires on" instead of "Renews on". | MEDIUM | Active subscription, Stripe customer portal navigation, billing page status verification |
| **Credit grant on subscription** | After subscribing to Go, the user must receive exactly 3,000 free credits (or for Pro, 15,000). Verify via the credit balance card on the billing page. | MEDIUM | Subscription creation must complete, webhook must be processed, billing page must render updated balance |
| **Credit topup purchase E2E** | Tests the credit bundle purchase flow: click Buy on a bundle, navigate to Stripe Checkout, complete payment, return to billing page, verify credit balance increased. | HIGH | Stripe Checkout page automation, credit topup webhook processing, billing page credit balance reactivity |
| **Fresh test user isolation** | Each test scenario must start with a clean user (no prior subscription, no credits beyond free signup grant). Prevents test pollution and false positives. | MEDIUM | Clerk Backend API for user creation, Convex billing state reset, Stripe customer cleanup |
| **Test infrastructure (fixtures, utilities, cleanup)** | Playwright fixtures for authenticated page, Stripe API client, waitForCondition helpers, billing snapshot assertions. Without these, every test is a copy-paste mess. | MEDIUM | Playwright fixture API, @clerk/testing integration, Stripe SDK |

## Differentiators

Features that go beyond basic "does it work" and test edge cases, resilience, and polish. These catch bugs that would otherwise be discovered by users in production.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| **Upgrade pro-rata credit verification** | After upgrading Go to Pro mid-cycle, verify the exact pro-rata credit amount (not just "some credits appeared"). Asserts `floor(remainingRatio * creditDelta)` matches what the billing page shows. | MEDIUM | Requires calculating expected pro-rata credits from proration date, comparing with actual credit balance delta |
| **Recurring payment credit grant** | Advancing time with Stripe test clocks to trigger a renewal invoice, then verifying monthly credits are granted exactly once. This catches duplicate-grant bugs that are invisible until the second billing cycle. | HIGH | Stripe test clock API (cannot use in browser E2E -- requires hybrid approach with API-level test clock + UI verification) |
| **Free credit capping behavior** | Verify that a free-tier user who has reached the free credit cap (2,000 for free plan) sees the cap banner on the billing page and cannot accumulate more free credits beyond the cap. | LOW | Free-tier user with credits at or near cap, billing page cap banner visibility assertion |
| **Payment failure handling visibility** | Subscribe with a failing card token (tok_chargeCustomerFail), verify the subscription lands in incomplete/past_due status, and the billing page shows the payment-failed notice with "Update payment method" CTA. | MEDIUM | Stripe test card for payment failure, webhook processing, billing page error state rendering |
| **Upgrade dialog dismiss prevention** | While the upgrade is processing (isConfirming=true), verify that Escape key, click-outside, and pointer-down-outside cannot dismiss the dialog. Prevents accidental abandonment during charge. | LOW | Active upgrade in progress, keyboard/mouse event assertions |
| **Downgrade cancel (keep current plan)** | After scheduling a downgrade from Pro to Go, verify the "Keep current plan" button on both the pricing page and billing page correctly cancels the scheduled change. | MEDIUM | Active downgrade schedule, button click + subscription details refresh verification |
| **Billing page skeleton loading states** | Verify that the billing page shows skeleton loading states while subscription data is settling, then renders the actual content. Prevents flash-of-empty-content. | LOW | Authenticated user with subscription, loading state timing assertions |
| **Stripe customer portal redirect** | For subscribed users, verify "Manage subscription" button redirects to Stripe customer portal URL. Does not need to test inside the portal (external domain). | LOW | Active subscription, window.location.href capture or navigation event assertion |
| **Credit topup return state handling** | After returning from Stripe Checkout with ?topup=success, verify the "Processing purchase" banner appears, and credits update reactively when the webhook processes. Also verify ?topup=canceled cleans the URL silently. | MEDIUM | Stripe Checkout return URL params, billing page reactive state, URL cleanup verification |

## Anti-Features

Test scenarios that seem valuable but are actively counterproductive to build or maintain.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| **Testing inside Stripe Checkout iframe** | "We should fill the card number, expiry, CVC in the Stripe Checkout form to make the test fully end-to-end" | Stripe explicitly states their "frontend interfaces have security measures in place that prevent automated testing" (docs.stripe.com/automated-testing). iframe selectors break between Stripe deployments. Tests become flaky and break on Stripe updates you do not control. This is the number one cause of Stripe E2E test failure. | Navigate TO the Stripe Checkout URL (verify redirect works), then use the Stripe API server-side to complete the payment intent/checkout session programmatically. Assert the return to your app with the correct URL params. |
| **Testing inside Stripe customer portal** | "We should verify the user can update their card and cancel inside the portal" | Same iframe/external-domain problem. Portal UI changes without notice. Your tests break on Stripe's schedule, not yours. | Verify the redirect TO the portal URL. Test cancellation/card-update effects by making direct Stripe API calls and then verifying your app's UI reacts to the webhook-driven state changes. |
| **Real-time clock-based renewal testing in browser** | "Use Stripe test clocks in the E2E test to advance time and test renewal in the browser" | Test clocks only work with customers created ON the test clock. You cannot attach a test clock to an existing Stripe customer created through Checkout. Browser E2E tests create customers through Checkout (no test clock). Test clocks are fundamentally a server-side tool. | Keep recurring-payment tests in the existing Vitest live-billing suite (which already uses test clocks with API-created customers). E2E tests verify the UI displays renewal-related data correctly -- they do not need to trigger the renewal. |
| **Testing webhook delivery itself** | "We should verify that Stripe actually delivers webhooks to our endpoint" | Webhook delivery is Stripe's infrastructure responsibility, not yours. Testing it requires Stripe CLI running, network tunneling, and creates flaky CI. Your existing live-billing tests already cover webhook-driven state changes. | E2E tests poll Convex queries to verify that state changes appear in the UI. The webhook is the mechanism, but the test asserts the outcome (UI shows updated plan/credits), not the mechanism. |
| **Per-locale billing page screenshots** | "We should screenshot the billing page in all 6 locales to catch i18n regressions" | Screenshot comparison tests are notoriously flaky (font rendering, sub-pixel differences, OS differences). They fail on every CI environment change and need constant baseline updates. | Test one locale end-to-end. Use unit tests (already 43 files of Vitest tests) for i18n string coverage. Visual regression testing is a separate concern from billing correctness. |
| **Testing credit deduction during extraction** | "We should do an extraction in the E2E test and verify credits are deducted" | Mixes billing testing with AI feature testing. Extraction depends on OpenAI API availability, prompt stability, and token costs. Credit deduction logic is already covered by unit tests. Adding this to billing E2E creates false failures from unrelated AI issues. | Keep credit deduction testing in unit tests. E2E billing tests verify credit balance display and credit grant flows only. |

## Feature Dependencies

```
[Clerk Auth Fixture]
    |--provides--> [Authenticated Page]
    |--used-by--> ALL billing E2E tests

[Stripe API Fixture]
    |--provides--> [Stripe client for server-side operations]
    |--used-by--> Checkout completion, cleanup, payment method attachment

[Billing State Reset]
    |--calls--> [Convex testing/billing:resetBillingStateForUser]
    |--calls--> [Stripe customer cleanup]
    |--used-in--> beforeEach hook for test isolation

[Subscription Creation E2E]
    |--step 1--> Navigate to /pricing (authenticated)
    |--step 2--> Click plan button ("Subscribe to Go"/"Subscribe to Pro")
    |--step 3--> Capture Stripe Checkout redirect URL
    |--step 4--> Complete Checkout via Stripe API (bypass iframe)
    |--step 5--> Navigate to return URL with session_id
    |--step 6--> Wait for subscription to sync (poll billing page)
    |--step 7--> Assert plan name, status badge, credit balance
    |--enables--> Upgrade E2E, Downgrade E2E, Cancellation E2E

[Upgrade E2E]
    |--requires--> Active Go subscription (from Subscription Creation)
    |--step 1--> Navigate to /pricing
    |--step 2--> Click "Upgrade to Pro" button
    |--step 3--> Wait for upgrade confirmation dialog
    |--step 4--> Assert dialog contents (plan change, charge, credits, payment method)
    |--step 5--> Click "Confirm upgrade"
    |--step 6--> Wait for success toast
    |--step 7--> Assert billing page shows Pro plan + updated credits

[Downgrade E2E]
    |--requires--> Active Pro subscription
    |--step 1--> Navigate to /pricing
    |--step 2--> Click "Downgrade to Go" button
    |--step 3--> Wait for billing page to show scheduled change banner
    |--step 4--> Assert plan still shows Pro + "Scheduled" badge on Go card

[Cancellation E2E]
    |--requires--> Active subscription
    |--approach--> Trigger cancellation via Stripe API (bypass portal iframe)
    |--step 1--> Call stripe.subscriptions.update with cancel_at_period_end: true
    |--step 2--> Wait for billing page to show "Expires on" instead of "Renews on"

[Credit Topup E2E]
    |--requires--> Authenticated user (any plan)
    |--step 1--> Navigate to /settings/billing
    |--step 2--> Click "Buy" on a credit bundle
    |--step 3--> Capture Stripe Checkout redirect URL
    |--step 4--> Complete Checkout via Stripe API (bypass iframe)
    |--step 5--> Navigate to return URL with ?topup=success
    |--step 6--> Assert "Processing purchase" banner appears
    |--step 7--> Wait for credit balance to increase (reactive update)
```

### Critical Dependency: Stripe Checkout Bypass Pattern

The most important architectural decision for the entire test suite is how to handle Stripe Checkout pages. Stripe's hosted Checkout lives on `checkout.stripe.com` and uses security measures that prevent reliable automated form filling. The pattern used by production billing test suites:

1. **Intercept the redirect**: When the app calls `window.location.href = checkoutUrl`, capture that URL
2. **Extract the session ID**: Parse `checkout.stripe.com/c/pay/cs_test_...` to get the session ID
3. **Complete via API**: Call `stripe.checkout.sessions.complete()` (test mode only) or create the payment intent directly via the Stripe API
4. **Navigate to success URL**: Direct the browser to the success URL that Stripe would redirect to

This avoids iframe automation entirely while still testing the full flow (button click -> redirect -> payment -> return -> state update).

### Critical Dependency: Webhook Processing Wait

Every billing E2E test that modifies Stripe state must wait for webhooks to be processed before asserting UI state. The pattern:

1. **Perform action** (subscribe, upgrade, purchase credits)
2. **Poll UI** using `page.waitForSelector` or `expect(locator).toContainText()` with generous timeouts
3. **Convex reactive queries** automatically update the UI when the backend state changes via webhooks
4. **Timeout with clear failure message** if the state does not appear within the expected window (30-60 seconds for webhook processing)

The existing Convex reactive subscription model means the UI will update automatically once the webhook is processed -- no manual refresh needed. The test just needs to wait for the UI to reflect the new state.

## MVP Recommendation

### Phase 1: Infrastructure + Subscription Creation (P0)

Build the test foundation first because every other test depends on it.

1. **Playwright fixtures** -- Authenticated page fixture with Clerk sign-in, Stripe API client fixture, billing state reset fixture
2. **Fresh user per scenario** -- Clerk Backend API creates a user in beforeAll, billing state is reset in beforeEach, Stripe customers are cleaned up in afterAll
3. **Stripe Checkout bypass utility** -- Capture redirect URL, complete session via API, navigate to return URL
4. **Webhook wait utility** -- Poll Convex-driven UI for state changes with configurable timeouts
5. **Subscription creation (free to Go)** -- First real test using all infrastructure above
6. **Subscription creation (free to Pro)** -- Validates different price ID routing

### Phase 2: Upgrade, Downgrade, Cancellation (P0)

Core lifecycle tests that exercise the v1.1 upgrade flow in the browser.

7. **Upgrade E2E (Go to Pro)** -- Proration dialog, payment method display, credit grant, success toast
8. **Downgrade E2E (Pro to Go)** -- Schedule verification, pending change banner, plan stays Pro before boundary
9. **Cancellation E2E** -- Via Stripe API (bypass portal), billing page shows expires-on
10. **Keep current plan (cancel downgrade)** -- Click "Cancel scheduled downgrade", verify pending change clears

### Phase 3: Credits + Edge Cases (P1)

Credit-specific flows and resilience tests.

11. **Credit grant verification (on subscribe)** -- Assert exact credit amounts after subscription
12. **Credit topup purchase E2E** -- Full checkout flow for credit bundles
13. **Free credit capping behavior** -- Cap banner visibility for free-tier users at cap
14. **Upgrade pro-rata credit verification** -- Assert calculated pro-rata credits match billing page

### Defer: Recurring Payment Cycle Credits

Keep in existing Vitest live-billing suite (already implemented with test clocks). E2E tests cannot use test clocks with Checkout-created customers. The live-billing tests at `tests/live-billing/required.test.ts` already cover this comprehensively.

### Defer: Payment Failure E2E

Can be added later. The existing live-billing extended test (`tests/live-billing/extended.test.ts`) already covers payment failure at the API level. A browser E2E for this would require a way to create a subscription with a failing card through the UI, which requires Stripe Checkout iframe automation (anti-feature).

## Complexity Budget

| Test Scenario | Estimated Lines of Test Code | Setup Required | Flakiness Risk |
|---------------|------------------------------|----------------|----------------|
| Subscription creation (Go) | 60-80 | High (all infra) | MEDIUM (Checkout + webhook timing) |
| Subscription creation (Pro) | 40-50 | Low (reuse infra) | MEDIUM |
| Upgrade Go to Pro | 80-100 | Medium (requires Go sub) | LOW (no Checkout, all in-app) |
| Downgrade Pro to Go | 50-60 | Medium (requires Pro sub) | LOW |
| Cancellation | 30-40 | Low | LOW |
| Credit grant on subscribe | 20-30 | Low (part of sub test) | MEDIUM (webhook timing) |
| Credit topup | 60-80 | Medium | MEDIUM (Checkout + webhook timing) |
| Free credit cap banner | 20-30 | Low | LOW |
| Pro-rata credit verification | 40-50 | Medium | LOW |
| Fixtures + utilities | 200-300 | One-time | N/A |

**Total estimated new code:** 560-820 lines of test code + 200-300 lines of infrastructure = approximately 760-1,120 lines.

The existing `e2e/` directory has 2 files (150 lines total). The existing `tests/live-billing/` directory has 3 files (845 lines). The new E2E suite will be comparable in size to the live-billing suite.

## Sources

- [Stripe Automated Testing Documentation](https://docs.stripe.com/automated-testing) -- Official guidance: "frontend interfaces have security measures that prevent automated testing" (HIGH confidence)
- [Stripe Testing Use Cases](https://docs.stripe.com/testing-use-cases) -- Official test scenarios for charges, disputes, refunds (HIGH confidence)
- [Stripe Test Card Numbers](https://docs.stripe.com/testing) -- Test card 4242424242424242, tok_visa, tok_chargeCustomerFail (HIGH confidence)
- [Clerk Testing with Playwright](https://clerk.com/docs/guides/development/testing/playwright/overview) -- clerkSetup(), clerk.signIn(), clerk.loaded() helpers (HIGH confidence)
- [Clerk Playwright Test Helpers](https://clerk.com/docs/guides/development/testing/playwright/test-helpers) -- signIn/signOut/loaded helper API reference (HIGH confidence)
- [Playwright Issue #19709: Stripe Checkout submission](https://github.com/microsoft/playwright/issues/19709) -- Confirms Checkout automation works locally but is fragile in CI due to timezone/environment differences (MEDIUM confidence)
- [Testing SaaS Billing with Playwright & Stripe Test Clocks (HackerNoon)](https://hackernoon.com/no-more-ship-and-pray-testing-saas-billing-systems-with-playwright-and-stripe-test-clocks) -- Three-layer architecture, webhook polling, invoice categorization patterns (MEDIUM confidence)
- [Testing Stripe Billing Cycles in 5 Minutes (DEV Community)](https://dev.to/paultowers/how-we-test-stripe-billing-cycles-in-5-minutes-instead-of-waiting-40-days-30jd) -- Test clock patterns, configurable polling with exponential backoff (MEDIUM confidence)
- [Playwright Browser Context Isolation](https://playwright.dev/docs/browser-contexts) -- Each test gets fresh browser context by default (HIGH confidence)
- Codebase analysis: `e2e/auth.spec.ts`, `e2e/global.setup.ts`, `playwright.config.ts`, `tests/live-billing/support.ts`, `tests/live-billing/required.test.ts`, `tests/live-billing/extended.test.ts`, `components/Pricing.tsx`, `app/settings/billing/page.tsx`, `components/billing/upgrade-confirmation-dialog.tsx`, `components/billing/credit-topup-card.tsx`, `convex/testing/billing.ts` (HIGH confidence)

---
*Feature research for: E2E Billing Tests (v1.2 milestone)*
*Researched: 2026-02-28*
