---
phase: 51-performance
plan: 02
subsystem: database
tags: [convex, indexes, cron, crypto, node]

# Dependency graph
requires:
  - phase: 50-security-schema-hardening
    provides: encryptedApiKey schema + crypto.ts decrypt utilities
provides:
  - by_expiry index on zoteroOAuthTokens for efficient cron cleanup
  - by_status_updatedAt composite index on subscriptions for cron queries
  - Standard node:crypto import replacing dynamic require() obfuscation
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use 'use node' directive with standard imports instead of dynamic require() obfuscation"
    - "Bounded cron queries with .take(N) to limit memory per run"

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/zotero/mutations.ts
    - convex/subscriptions/internal.ts
    - convex/maintenance/mutations.ts
    - convex/lib/crypto.ts

key-decisions:
  - "Kept .take(100) on OAuth cleanup to bound memory per cron run"
  - "Preserved by_status index alongside new by_status_updatedAt for backward compat with other queries"

patterns-established:
  - "Index-based cron: cron jobs should use database indexes, not full table scans"
  - "Standard node imports: use 'use node' + import from 'node:crypto' in Convex Node.js files"

requirements-completed: [PERF-03, PERF-04, PERF-05]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 51 Plan 02: Cron Index Optimization + Crypto Import Summary

**Added by_expiry and by_status_updatedAt indexes for cron efficiency, replaced crypto require() obfuscation with standard node:crypto import**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T09:43:33Z
- **Completed:** 2026-03-03T09:46:08Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `by_expiry` index on `zoteroOAuthTokens` so cleanup cron queries only expired tokens instead of scanning the full table
- Added `by_status_updatedAt` composite index on `subscriptions` for efficient cron queries with future updatedAt range support
- Updated `listActiveSubscriptions` and `expirePastDueSubscriptions` to use the new composite index
- Replaced fragile `getCrypto()` dynamic require() obfuscation with standard `"use node"` + `import * as crypto from "node:crypto"`

## Task Commits

Each task was committed atomically:

1. **Task 1: Add by_expiry index and refactor cleanup cron** - `fc10524` (feat)
2. **Task 2: Add composite subscription index + fix crypto import** - `ef5d225` (feat)

**Plan metadata:** `3fe3449` (docs: complete plan)

## Files Created/Modified
- `convex/schema.ts` - Added by_expiry index on zoteroOAuthTokens, by_status_updatedAt composite index on subscriptions
- `convex/zotero/mutations.ts` - Replaced full table scan with withIndex("by_expiry") + .take(100) bound
- `convex/subscriptions/internal.ts` - Updated listActiveSubscriptions to use by_status_updatedAt index
- `convex/maintenance/mutations.ts` - Updated expirePastDueSubscriptions to use by_status_updatedAt index
- `convex/lib/crypto.ts` - Added "use node" directive, replaced getCrypto() obfuscation with standard node:crypto import

## Decisions Made
- Kept `.take(100)` on OAuth cleanup to bound memory per cron run (prevents transaction limit violations as table grows)
- Preserved existing `by_status` index alongside new `by_status_updatedAt` for backward compatibility with `listGrantEligibleSubscriptionPointers` and other queries that only need status filtering

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All PERF requirements for Phase 51 are addressed (Plan 01 handles PERF-01/PERF-02, Plan 02 handles PERF-03/PERF-04/PERF-05)
- Schema changes require `npx convex deploy` to activate new indexes in production
- No blockers for subsequent phases

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 51-performance*
*Completed: 2026-03-03*
