---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: E2E Billing Tests
status: unknown
last_updated: "2026-02-28T07:55:04.689Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 8
  completed_plans: 8
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Every billing operation produces correct financial outcomes -- the right amount charged, at the right time, with proper proration and user feedback.
**Current focus:** Phase 11 -- Tech Debt Cleanup (next)

## Current Position

Phase: 10 of 11 (Fix Credits Spec Auth Wiring) -- fourth phase of v1.2
Plan: 10-01 complete, all 1 plans done
Status: Phase 10 complete -- moving to Phase 11
Last activity: 2026-02-28 -- Plan 10-01 credits spec auth fix complete

Progress: [████████████████░░░░] 80% (v1.2: 4/5 phases complete, 8/9 plans done)

## Performance Metrics

**Velocity:**
- Total plans completed: 18 (v1.0: 7, v1.1: 6, v1.2: 5)
- v1.2 plans completed: 5
- v1.2 total execution time: 11min

**By Phase (v1.2):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 7 | 3/3 | - | - |
| 8 | 2/2 | 3min | 1.5min |
| 9 | 2/2 | 5min | 2.5min |
| 10 | 1/1 | 3min | 3min |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent decisions affecting current work:
- Checkout-bypass pattern for subscription/topup tests (Stripe blocks hosted checkout automation)
- `workers: 1` mandatory due to Clerk concurrent auth bug (#7891)
- WebhookWaiter polls Convex state before UI assertions (eliminates timing flakes)
- Each subscribe test gets its own fresh Clerk user for full isolation (08-01)
- Credit assertions use >= because free signup credits (2,000) are always present (08-01)
- Upgrade credit assertion uses > 5000 threshold (not exact Pro amount) since pro-rata credits vary with timing (08-02)
- Dialog verification checks plan names only, not dollar amounts (volatile proration values) (08-02)
- Downgrade triggers no confirmation dialog -- re-navigate after clickSubscribe to see updated state (09-01)
- Cancel subscription uses Stripe API bypass (cancel_at_period_end) since Customer Portal cannot be automated (09-01)
- Assert text patterns only (visibility, /expires on/i) -- no exact dates in lifecycle tests (09-01)
- Subscription item period fields (items.data[0]) for Stripe clover API compatibility (09-02)
- Pro-rata credit tolerance +-2 accounts for timing gap between test and server calculation (09-02)
- Credit topup test subscribes to Go first to establish Stripe customer with payment method (09-02)

### Pending Todos

None.

### Blockers/Concerns

- 9 human verification items pending Stripe test mode validation (from v1.1)
- 3 pre-existing TypeScript errors in test files (unrelated to milestone work)

## Session Continuity

Last session: 2026-02-28
Stopped at: Completed 10-01-PLAN.md -- added clerkUser fixture to CRED-01 and CRED-05 credits tests
Resume file: None
