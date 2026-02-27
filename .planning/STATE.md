# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Every billing operation produces correct financial outcomes -- the right amount charged, at the right time, with proper proration and user feedback.
**Current focus:** Phase 1 - Subscription Lifecycle Correctness

## Current Position

Phase: 1 of 3 (Subscription Lifecycle Correctness) -- COMPLETE
Plan: 3 of 3 in current phase -- ALL COMPLETE
Status: Phase Complete
Last activity: 2026-02-27 -- Completed 01-03-PLAN.md

Progress: [##########] 100% (Phase 1)

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 3min
- Total execution time: 0.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | 10min | 3min |

**Recent Trend:**
- Last 5 plans: 01-01 (3min), 01-02 (3min), 01-03 (4min)
- Trend: Consistent

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Three-phase structure derived from requirement categories (SUB -> CRED -> INFRA) following codebase dependency graph
- [Roadmap]: Phase 1 addresses all 3 confirmed critical bugs (proration, out-of-order webhooks, cancellation orphans) before credit system work
- [01-01]: Used internalAction in actions.ts for Stripe re-fetch instead of direct client in http.ts (Convex JS runtime cannot use stripe npm package)
- [01-01]: Reused syncLocalSubscriptionFromStripe helper in handleSubscriptionWebhook for consistency
- [01-02]: Used always_invoice + error_if_incomplete together for immediate proration charge with card decline blocking
- [01-02]: Post-release schedule verification re-fetches subscription and asserts schedule === null (defensive against Stripe eventual consistency)
- [01-02]: getUpgradePreview uses invoices.createPreview (not deprecated retrieveUpcoming) matching API version 2026-01-28.clover
- [01-03]: pastDueSince set only on first past_due transition to avoid resetting grace period on repeated failures
- [01-03]: Grace period is 7 days; after expiry, subscription auto-downgrades to free plan with canceled status
- [01-03]: All features remain accessible during past_due grace period (no access gating)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: `checkSubscriptionStatus` corrective action needs a business decision on what action to take (sync from Stripe? cancel stale? notify user?)
- [Phase 2]: Free credit cap policy (whether cap should allow rollover) is a business decision, not technical

## Session Continuity

Last session: 2026-02-27
Stopped at: Completed 01-03-PLAN.md (payment failure UX + grace period) -- Phase 1 COMPLETE
Resume file: None
