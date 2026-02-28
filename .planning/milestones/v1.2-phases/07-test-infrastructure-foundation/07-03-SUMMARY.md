---
phase: 07-test-infrastructure-foundation
plan: 03
subsystem: testing
tags: [playwright, clerk, e2e, page-object-model, fixture]

requires:
  - phase: 07-test-infrastructure-foundation
    provides: data-testid attributes (Plan 01), Stripe helpers and WebhookWaiter (Plan 02)
provides:
  - BillingPage page object model targeting billing data-testid selectors
  - PricingPage page object model targeting pricing data-testid selectors
  - Composing billing fixture with per-test Clerk user lifecycle, Stripe client, webhook waiter, and page objects
affects: [08-subscription-and-upgrade-specs, 09-lifecycle-and-credit-specs]

tech-stack:
  added: [@clerk/testing, @clerk/backend]
  patterns: [Playwright test.extend fixture composition, page object model pattern]

key-files:
  created:
    - e2e/billing/pages/billing-page.ts
    - e2e/billing/pages/pricing-page.ts
    - e2e/billing/fixtures.ts
  modified: []

key-decisions:
  - "Per-test user isolation via unique timestamped email addresses"
  - "Convex userId discovery via npx convex run users/mutations:ensureUser with Clerk identity"
  - "Layered teardown: Clerk user deletion + Convex billing state reset (Stripe cleanup per-test)"
  - "Page navigation to /settings/billing in clerkUser fixture triggers Convex ensureUser"

patterns-established:
  - "import { test, expect } from './fixtures' for all billing E2E tests"
  - "BillingPage/PricingPage POM pattern: locator properties + typed convenience methods"
  - "Fixture teardown order: signOut -> deleteUser -> resetBillingState"

requirements-completed: [INFRA-02, INFRA-05, INFRA-07]

duration: 5min
completed: 2026-02-28
---

# Plan 07-03: Page Objects and Billing Fixture Summary

**BillingPage/PricingPage POMs and composing billing fixture enabling ~10-line E2E tests**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28
- **Completed:** 2026-02-28
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- BillingPage POM with 7 methods (goto, getPlanName, getStatusBadgeText, getRenewalText, getCreditBalance, clickManageButton, clickKeepPlan) and 10 locator properties
- PricingPage POM with 4 methods (goto, clickSubscribe, getButtonText) and 5 locator properties for badges and upgrade dialog
- Composing billing fixture providing 5 fixtures (clerkUser, stripeClient, webhookWaiter, billingPage, pricingPage)
- Per-test Clerk user isolation with automatic signup, sign-in, and cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BillingPage and PricingPage POMs** - `e45e047` (feat)
2. **Task 2: Create billing test fixture** - `5c8e99d` (feat)

## Files Created/Modified
- `e2e/billing/pages/billing-page.ts` - BillingPage POM targeting billing data-testid selectors
- `e2e/billing/pages/pricing-page.ts` - PricingPage POM targeting pricing and upgrade dialog data-testid selectors
- `e2e/billing/fixtures.ts` - Composing fixture with Clerk user lifecycle, Stripe client, webhook waiter, and POMs

## Decisions Made
- Per-test user isolation via unique timestamped email addresses (billing-e2e-{timestamp}-{random}@test.example.com)
- Convex userId discovered via `npx convex run users/mutations:ensureUser` with Clerk identity
- Page navigation to /settings/billing in clerkUser fixture triggers Convex ensureUser for user creation
- Stripe cleanup happens in individual tests (not all tests create subscriptions)

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 tests can import { test, expect } from "./fixtures" and write ~10-15 line billing specs
- All page objects, utilities, and fixtures are ready for subscription and upgrade E2E tests
- Fixture handles complete user lifecycle (create, sign-in, cleanup) automatically

---
*Phase: 07-test-infrastructure-foundation*
*Completed: 2026-02-28*
