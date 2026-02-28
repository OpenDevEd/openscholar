---
phase: 07-test-infrastructure-foundation
plan: 02
subsystem: testing
tags: [playwright, stripe, convex, e2e, webhook]

requires:
  - phase: 06-ux-polish
    provides: Production app as system under test
provides:
  - Billing Playwright project configuration (180s timeout, workers:1, en-US locale)
  - Stripe helpers module with checkout-bypass subscription creation and cleanup
  - WebhookWaiter utility for Convex billing state polling
affects: [07-test-infrastructure-foundation]

tech-stack:
  added: []
  patterns: [checkout-bypass for Stripe E2E tests, CLI-based Convex state polling]

key-files:
  created:
    - e2e/billing/stripe-helpers.ts
    - e2e/billing/webhook-waiter.ts
  modified:
    - playwright.config.ts

key-decisions:
  - "CLI-based polling (npx convex run) over DOM-based polling for webhook waiter"
  - "Class-based WebhookWaiter API -- constructor takes userId, methods are clean one-liners"
  - "Default project ignores billing tests to prevent accidental cross-contamination"
  - "API version matches project standard: 2026-01-28.clover"

patterns-established:
  - "checkout-bypass: create customer + attach PM + create subscription via API (no hosted checkout)"
  - "WebhookWaiter: poll Convex state before UI assertions to eliminate timing flakes"
  - "billing project separation: testDir=./e2e/billing, testIgnore=**/billing/** on default"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03, INFRA-04]

duration: 5min
completed: 2026-02-28
---

# Plan 07-02: Playwright Config & Utility Modules Summary

**Billing Playwright project with Stripe checkout-bypass helpers and Convex webhook state poller**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28
- **Completed:** 2026-02-28
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Billing Playwright project configured with 180s timeout, serial execution (workers:1), and en-US locale
- Stripe helpers module with checkout-bypass subscription creation avoiding hosted checkout automation
- WebhookWaiter utility polls Convex for subscription plan state and credit balance convergence
- Default project updated to ignore billing test directory

## Task Commits

Each task was committed atomically:

1. **Task 1: Add billing project and Stripe helpers** - `0c199d0` (feat)
2. **Task 2: Create webhook waiter utility** - `4df84b6` (feat)

## Files Created/Modified
- `playwright.config.ts` - Added billing and default projects to config
- `e2e/billing/stripe-helpers.ts` - Stripe API helpers for checkout-bypass and cleanup
- `e2e/billing/webhook-waiter.ts` - WebhookWaiter class for Convex state polling

## Decisions Made
- Used CLI-based polling (npx convex run) for webhook waiter -- works regardless of current page
- Class-based WebhookWaiter API for clean test readability
- Matched project Stripe API version (2026-01-28.clover)

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stripe helpers and webhook waiter ready for Plan 03 fixture composition
- Billing Playwright project ready to discover and run specs from e2e/billing/
- All utility modules export clean TypeScript interfaces for fixture integration

---
*Phase: 07-test-infrastructure-foundation*
*Completed: 2026-02-28*
