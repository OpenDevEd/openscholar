---
phase: 60-convex-validators-typed-records
plan: 01
subsystem: database
tags: [convex, validators, type-safety, v.any, v.object, v.record]

# Dependency graph
requires: []
provides:
  - Typed return validators for all extraction debug/test functions
  - Typed return validator for getBillingSnapshotForUser (billing snapshot query)
  - Documented v.any() limitation for Clerk webhook data (v.unknown() unavailable in Convex 1.32.0)
affects: [60-convex-validators-typed-records]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "v.record(v.string(), v.number()) for dynamic status-count maps in extraction debug"
    - "v.record(v.string(), v.string()) for metadata fields matching schema.ts"
    - "v.optional() for fields that may be undefined from optional schema columns"

key-files:
  created: []
  modified:
    - convex/extraction/debug.ts
    - convex/extraction/debug_errors.ts
    - convex/extraction/test_runner.ts
    - convex/extraction/create_test_job.ts
    - convex/extraction/testActions.ts
    - convex/testing/billing.ts
    - convex/webhooks/actions.ts

key-decisions:
  - "Used v.record(v.string(), v.number()) for dynamic key-value status counts instead of restructuring to arrays"
  - "Kept v.any() for Clerk webhook data field because v.unknown() not available in Convex 1.32.0"
  - "Used v.string() for schema union literal fields (plan, status, type) in return validators for simplicity"
  - "Matched metadata field to schema: v.optional(v.record(v.string(), v.string()))"

patterns-established:
  - "Return validators mirror schema field types but can use v.string() for union literals in debug/snapshot contexts"
  - "v.record() preferred over v.any() for dynamic key-value maps"

requirements-completed: [CONV-01]

# Metrics
duration: 4min
completed: 2026-03-04
---

# Phase 60 Plan 01: Replace v.any() Validators Summary

**Typed return validators for 8 extraction/billing/webhook functions using v.object(), v.record(), v.id(), eliminating 7 of 8 v.any() usages**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-04T10:14:35Z
- **Completed:** 2026-03-04T10:18:50Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Replaced v.any() with typed v.object() validators in 6 extraction debug/test functions across 5 files
- Replaced v.any() with comprehensive typed validator in getBillingSnapshotForUser covering 7 nested data sections
- Used v.record(v.string(), v.number()) for dynamic status count maps (byStatus, statusCounts)
- All 780 tests pass, no TypeScript errors introduced
- Only 1 v.any() remains: Clerk webhook data (v.unknown() not in Convex 1.32.0)

## Task Commits

Each task was committed atomically:

1. **Task 1: Type extraction debug/test function return validators** - `93febde` (feat) -- note: bundled in prior session's 60-02 commit
2. **Task 2: Type billing and webhook return validators** - `129fe89` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `convex/extraction/debug.ts` - diagnoseJob: typed return with job, papersSummary, samplePapers, failedPapersDetails
- `convex/extraction/debug_errors.ts` - getFailedPapersDebug: typed return with failedPapers, downloadFailedPapers, counts
- `convex/extraction/test_runner.ts` - createAndRunTestJob and getTestJobStatus: full return type coverage with v.record for status maps
- `convex/extraction/create_test_job.ts` - createTestJobForFix: typed { jobId: v.id("extractionJobs") }
- `convex/extraction/testActions.ts` - createTestJob: typed { jobId: v.string() }, removed redundant Promise annotation
- `convex/testing/billing.ts` - getBillingSnapshotForUser: typed 7-section return (user, objectIds, credits, subscriptions, billingCustomers, creditTransactions, stripeEventLogs)
- `convex/webhooks/actions.ts` - verifyClerkWebhook: documented v.any() as unavoidable (v.unknown() absent)

## Decisions Made
- Used `v.record(v.string(), v.number())` for dynamic status-count maps (byStatus in diagnoseJob, statusCounts in getTestJobStatus) since v.record is available in Convex 1.32.0 and already used in schema.ts
- Kept `v.any()` for Clerk webhook `data` field because `v.unknown()` is not available in Convex 1.32.0 and the data is opaque JSON from Clerk whose shape varies by event type
- Used `v.string()` for schema union literal fields (plan, status, type, creditType) in return validators since all union members are string literals
- Matched `metadata` in creditTransactions to `v.optional(v.record(v.string(), v.string()))` per schema.ts definition

## Deviations from Plan

### Limitation: v.unknown() Not Available

**1. [Constraint] Clerk webhook data field cannot be typed**
- **Found during:** Task 2 (webhook return validator)
- **Issue:** Plan specified `v.unknown()` for Clerk webhook data, but `v.unknown()` does not exist in Convex 1.32.0 (only: any, array, bigint, boolean, bytes, float64, id, int64, literal, null, nullable, number, object, optional, record, string, union)
- **Result:** `v.any()` retained with explanatory comment; no runtime behavior change
- **Impact:** 1 of 8 v.any() usages remains; will be resolved when Convex adds v.unknown()

### Pre-existing: Task 1 Already Committed

**2. [Process] Task 1 changes were bundled in prior session commit**
- **Found during:** Task 1 staging
- **Issue:** All 5 extraction file changes were already committed as `93febde` (labeled `fix(60-02)`) in a prior session
- **Result:** Task 1 did not produce a new commit; changes verified as correct
- **Impact:** None on correctness; commit attribution is non-standard

---

**Total deviations:** 2 (1 Convex version limitation, 1 process)
**Impact on plan:** 7 of 8 v.any() usages eliminated. Remaining 1 is a platform limitation, not scope gap.

## Issues Encountered
- `v.unknown()` not available in Convex 1.32.0 -- only workaround would be serializing data to string (which changes runtime behavior, prohibited by plan)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All extraction, billing, and webhook return validators are typed
- Foundation ready for Phase 60 Plan 02 (typed records)
- Clerk webhook data v.any() is a known deferred item for when Convex adds v.unknown()

---
*Phase: 60-convex-validators-typed-records*
*Completed: 2026-03-04*
