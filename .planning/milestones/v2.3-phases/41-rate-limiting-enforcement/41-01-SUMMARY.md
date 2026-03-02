---
phase: 41-rate-limiting-enforcement
plan: 01
subsystem: api
tags: [rate-limiting, convex-helpers, token-bucket, security]

# Dependency graph
requires:
  - phase: 37-schema-hardening
    provides: rateLimits table in schema for convex-helpers token-bucket storage
provides:
  - Token-bucket rate limits on extraction, API key save, and checkout endpoints
  - Centralized defineRateLimits config in convex/lib/rateLimit.ts
  - consume internal mutation for action endpoints lacking ctx.db
affects: [42-final-audit]

# Tech tracking
tech-stack:
  added: [convex-helpers/server/rateLimit defineRateLimits]
  patterns: [token-bucket rate limiting, consume internal mutation for actions]

key-files:
  created: []
  modified:
    - convex/lib/rateLimit.ts
    - convex/extraction/mutations.ts
    - convex/apiKeys/actions.ts
    - convex/subscriptions/actions.ts
    - convex/credits/actions.ts

key-decisions:
  - "Shared start-extraction rate limit name across startExtraction, duplicateExtraction, startExtractionFromTemplate since all create extraction jobs"
  - "Shared checkout-session rate limit name across subscription and credit top-up checkout since same abuse profile"
  - "Auth-first pattern: getUserIdentity added to encryptAndSave action for rate limit key since action had no existing auth check"

patterns-established:
  - "Mutations call rateLimit(ctx, ...) directly; actions delegate to consume internal mutation via ctx.runMutation"
  - "Rate limit ordering: feature flags first, auth second, rate limit third, business logic last"

requirements-completed: [RATE-02, RATE-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 41 Plan 01: Rate Limiting Enforcement Summary

**Token-bucket rate limits enforced on 6 endpoints using convex-helpers defineRateLimits with per-user keys**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T09:48:30Z
- **Completed:** 2026-03-02T09:50:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Replaced stub rateLimit.ts with real convex-helpers defineRateLimits configuration (3 token-bucket limits)
- Enforced rate limits on all 6 target endpoints with correct auth-first ordering
- Added consume internal mutation enabling action endpoints (no ctx.db) to enforce rate limits

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace rateLimit.ts stub with defineRateLimits config and consume mutation** - `d1db6b2` (feat)
2. **Task 2: Add rate limit enforcement to all 6 target endpoints** - `c54f350` (feat)

## Files Created/Modified
- `convex/lib/rateLimit.ts` - Centralized defineRateLimits config (start-extraction 5/hr burst 3, api-key-save 5/min burst 5, checkout-session 3/min burst 3) plus consume internal mutation
- `convex/extraction/mutations.ts` - rateLimit() calls in startExtraction, duplicateExtraction, startExtractionFromTemplate
- `convex/apiKeys/actions.ts` - consume("api-key-save") via internal mutation with auth gate
- `convex/subscriptions/actions.ts` - consume("checkout-session") via internal mutation after requireActionAuth
- `convex/credits/actions.ts` - consume("checkout-session") via internal mutation after requireActionAuth

## Decisions Made
- Shared `start-extraction` rate limit name across all three extraction mutations since they all create extraction jobs and should share a per-user token bucket
- Shared `checkout-session` rate limit name across subscription and credit top-up checkout actions since they have the same Stripe session abuse profile
- Added `ctx.auth.getUserIdentity()` to `encryptAndSave` action for rate limit key since the action previously had no action-level auth check (auth was in the internal `save` mutation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 target endpoints enforce per-user rate limits
- Ready for Phase 42 (final audit) if planned
- 3 pre-existing TypeScript errors in test files remain (unrelated to this work)

---
*Phase: 41-rate-limiting-enforcement*
*Completed: 2026-03-02*
