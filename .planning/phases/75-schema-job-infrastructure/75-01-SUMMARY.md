---
phase: 75-schema-job-infrastructure
plan: 01
subsystem: database
tags: [convex, schema, workpool, validators, screening]

# Dependency graph
requires: []
provides:
  - screeningJobs and screeningResults table definitions in Convex schema
  - Shared screening validators for mutations/queries
  - Screening error codes in ErrorCode union
  - Dedicated screeningPool workpool instance
  - MAX_SCREENING_PAPERS_PER_JOB and MAX_SCREENING_JOBS_PER_USER constants
affects: [75-02, 75-03, screening-mutations, screening-queries]

# Tech tracking
tech-stack:
  added: []
  patterns: [separate workpool component for domain isolation]

key-files:
  created:
    - convex/screening/validators.ts
  modified:
    - convex/schema.ts
    - convex/lib/errors.ts
    - convex/lib/queryBounds.ts
    - convex/workpool.ts
    - convex/convex.config.ts

key-decisions:
  - "Separate screeningWorkpool component for true cancelAll() isolation from extraction"
  - "Inline validators in schema.ts, shared validators in screening/validators.ts for mutations/queries"

patterns-established:
  - "Domain workpool isolation: register separate component instances per domain to avoid cross-cancellation"

requirements-completed: [JOB-01]

# Metrics
duration: 2min
completed: 2026-03-09
---

# Phase 75 Plan 01: Schema & Job Infrastructure Summary

**Screening schema tables, shared validators, error codes, query bounds, and isolated workpool for bulk paper screening**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-09T00:21:12Z
- **Completed:** 2026-03-09T00:22:52Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created screeningJobs and screeningResults tables with proper indexes deployed to Convex
- Built 6 reusable validators for screening mutations and queries
- Added 3 screening-specific error codes to the typed ErrorCode union
- Configured dedicated screeningWorkpool component for domain isolation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create screening validators and query bounds constant** - `75d174b` (feat)
2. **Task 2: Add schema tables, error codes, and screening workpool** - `1e6febf` (feat)

## Files Created/Modified
- `convex/screening/validators.ts` - 6 shared validators (question, scoring rule, scoring config, paper input, job status, result status)
- `convex/schema.ts` - screeningJobs and screeningResults table definitions with indexes
- `convex/lib/errors.ts` - 3 screening error codes (SCREENING_JOB_ALREADY_ACTIVE, NOT_FOUND, NOT_CANCELLABLE)
- `convex/lib/queryBounds.ts` - MAX_SCREENING_PAPERS_PER_JOB (200) and MAX_SCREENING_JOBS_PER_USER (500)
- `convex/workpool.ts` - screeningPool with maxParallelism 5
- `convex/convex.config.ts` - screeningWorkpool component registration

## Decisions Made
- Used a separate workpool component (screeningWorkpool) instead of sharing the existing workpool component, ensuring cancelAll() on one domain does not affect the other
- Kept validators inline in schema.ts as required by Convex, with matching shared validators in screening/validators.ts for use in mutation/query args

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added separate workpool component for true isolation**
- **Found during:** Task 2 (screening workpool)
- **Issue:** Using same workpool component would share tables, making cancelAll() affect both extraction and screening
- **Fix:** Registered a second workpool component instance named "screeningWorkpool" in convex.config.ts
- **Files modified:** convex/convex.config.ts
- **Verification:** npx convex dev --once succeeded, component installed
- **Committed in:** 1e6febf (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for correct workpool isolation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema tables deployed and ready for mutations/queries
- Validators importable for screening mutation args
- Error codes typed for screening error handling
- Workpool configured for bulk screening job processing

---
*Phase: 75-schema-job-infrastructure*
*Completed: 2026-03-09*
