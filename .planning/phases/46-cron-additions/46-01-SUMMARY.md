---
phase: 46-cron-additions
plan: 01
subsystem: database
tags: [convex, cron, zotero, oauth, cleanup]

# Dependency graph
requires:
  - phase: 36-zotero-connect
    provides: zoteroOAuthTokens table and OAuth flow
provides:
  - cleanupExpiredOAuthTokens internal mutation for automatic token cleanup
  - Hourly cron registration for expired Zotero OAuth token cleanup
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [hourly-cron-cleanup, try-catch-concurrent-delete]

key-files:
  created: []
  modified:
    - convex/zotero/mutations.ts
    - convex/crons.ts

key-decisions:
  - "Used .collect() for token query since table is tiny (0-5 rows during active OAuth flows)"
  - "try-catch per delete handles concurrent deletion race with getRequestToken"
  - "Logging only when deletedCount > 0 to avoid noisy hourly cron logs"

patterns-established:
  - "Concurrent-safe cron cleanup: try-catch per delete when multiple code paths can delete same record"

requirements-completed: [CRON-01]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 46 Plan 01: Expired OAuth Token Cleanup Cron Summary

**Hourly cron job deleting expired Zotero OAuth request tokens with concurrent-safe per-delete try-catch**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T06:18:51Z
- **Completed:** 2026-03-03T06:21:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `cleanupExpiredOAuthTokens` internalMutation to handle abandoned OAuth flows
- Registered hourly cron in `convex/crons.ts` matching existing cron patterns
- Verified mutation runs successfully on dev deployment (returns null, no errors)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cleanupExpiredOAuthTokens mutation and register cron** - `12d92a2` (feat)
2. **Task 2: Deploy and verify cron registration** - no code changes (deploy/verify only)

## Files Created/Modified
- `convex/zotero/mutations.ts` - Added `cleanupExpiredOAuthTokens` internalMutation that queries all zoteroOAuthTokens, deletes expired ones with try-catch per delete
- `convex/crons.ts` - Added hourly cron entry calling `internal.zotero.mutations.cleanupExpiredOAuthTokens`

## Decisions Made
- Used `.collect()` for token query since the `zoteroOAuthTokens` table is tiny (0-5 rows during active OAuth flows) -- no index on `expiresAt` needed
- Wrapped individual deletes in try-catch to handle concurrent deletion race with `getRequestToken` (which also deletes expired tokens it encounters)
- Logging deletion count only when `deletedCount > 0` to avoid noisy hourly cron logs (common case is 0 expired tokens)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Production Convex deployment (`mellow-impala-519`) is missing `CLERK_JWT_ISSUER_DOMAIN` environment variable, preventing `npx convex deploy`. This is a pre-existing configuration issue unrelated to this plan's changes. Dev deployment succeeded and mutation was verified working. Production deployment should be done once the missing env var is configured.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Cron job code is deployed to dev and verified
- Production deployment blocked by pre-existing missing `CLERK_JWT_ISSUER_DOMAIN` env var (not introduced by this plan)
- No further phases depend on this plan

## Self-Check: PASSED

- FOUND: convex/zotero/mutations.ts
- FOUND: convex/crons.ts
- FOUND: 46-01-SUMMARY.md
- FOUND: commit 12d92a2

---
*Phase: 46-cron-additions*
*Completed: 2026-03-03*
