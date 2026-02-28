---
phase: 07-test-infrastructure-foundation
status: passed
verified: 2026-02-28
score: 7/7
---

# Phase 7: Test Infrastructure Foundation -- Verification

## Phase Goal
A developer can write a billing E2E test in a few lines using the fixture and page objects, with correct isolation, cleanup, and webhook timing built in.

## Success Criteria Verification

### SC1: Billing Playwright project configured
**Status: PASSED**

`npx playwright test --project=billing` selects the billing test project with:
- timeout: 180,000ms (180s)
- workers: 1 (serial execution)
- fullyParallel: false
- locale: "en-US"
- testDir: "./e2e/billing"

Evidence: `playwright.config.ts` lines 68-77 contain the billing project configuration.

### SC2: Fresh Clerk user per test with sign-in and cleanup
**Status: PASSED**

The billing fixture's `clerkUser` fixture:
- Creates a unique Clerk user per test via `createClerkClient().users.createUser()`
- Signs in via `clerk.signIn()` with password strategy
- Auto-deletes via `clerkClient.users.deleteUser()` in teardown

Evidence: `e2e/billing/fixtures.ts` clerkUser fixture implementation.

### SC3: Webhook waiter for Convex state convergence
**Status: PASSED**

`WebhookWaiter` class provides:
- `waitForSubscriptionPlan(plan)` -- blocks until Convex shows expected plan + active status
- `waitForCreditBalance(predicate)` -- blocks until credit total satisfies condition
- `waitForBillingCustomerLink()` -- blocks until customer link exists

Uses `npx convex run` CLI to poll `testing/billing:getBillingSnapshotForUser`.

Evidence: `e2e/billing/webhook-waiter.ts` exports WebhookWaiter with all methods.

### SC4: Page objects with data-testid selectors
**Status: PASSED**

- `BillingPage` has methods: `getPlanName()`, `getCreditBalance()`, `getStatusBadgeText()`, `getRenewalText()`, `clickManageButton()`, `clickKeepPlan()` -- all using `data-testid` selectors
- `PricingPage` has methods: `clickSubscribe(planId)`, `getButtonText(planId)` and locator properties for badges and upgrade dialog -- all using `data-testid` selectors

No raw CSS class selectors used in either POM.

Evidence: `e2e/billing/pages/billing-page.ts` (11 data-testid references), `e2e/billing/pages/pricing-page.ts` (9 data-testid references).

### SC5: Billing UI components have stable data-testid attributes
**Status: PASSED**

- `app/settings/billing/page.tsx`: 7 data-testid attributes (plan-name, status-badge, renewal-date, pending-change-banner, keep-plan-button, credit-cap-banner, manage-button)
- `components/billing/credit-balance-card.tsx`: 3 data-testid attributes (credit-balance, free-credits, paid-credits)
- `components/Pricing.tsx`: 4 data-testid attributes (plan-{id}, button-{id}, current-badge, scheduled-badge)
- `components/billing/upgrade-confirmation-dialog.tsx`: 4 data-testid attributes (confirm-button, cancel-button, 2x total-charge)

Evidence: grep confirms 18 unique data-testid attribute locations across 4 component files.

## Requirements Traceability

| Requirement ID | Plan | Status | Evidence |
|----------------|------|--------|----------|
| INFRA-01 | 07-02 | SATISFIED | Billing project in playwright.config.ts with 180s timeout, workers:1, en-US locale |
| INFRA-02 | 07-02, 07-03 | SATISFIED | Clerk user creation in fixture + signIn; proven pattern from global.setup.ts |
| INFRA-03 | 07-02 | SATISFIED | WebhookWaiter class with waitForSubscriptionPlan, waitForCreditBalance methods |
| INFRA-04 | 07-02 | SATISFIED | stripe-helpers.ts with createSubscriptionBypass, attachTestPaymentMethod, cleanupStripeCustomer |
| INFRA-05 | 07-03 | SATISFIED | BillingPage and PricingPage POMs with data-testid selectors |
| INFRA-06 | 07-01 | SATISFIED | 18 data-testid attributes across 4 billing UI components |
| INFRA-07 | 07-03 | SATISFIED | fixtures.ts composes clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage |

**All 7/7 requirements satisfied.**

## Summary

Phase 7 goal achieved: a developer can write a billing E2E test in ~10-15 lines by importing `{ test, expect }` from `e2e/billing/fixtures.ts`. The fixture provides fresh Clerk user isolation, Stripe checkout-bypass helpers, Convex webhook state polling, and typed page objects -- all with automatic cleanup on teardown.
