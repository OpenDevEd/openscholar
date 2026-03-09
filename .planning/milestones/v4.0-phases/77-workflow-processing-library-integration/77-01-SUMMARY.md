---
phase: 77-workflow-processing-library-integration
plan: 01
subsystem: api
tags: [convex, workpool, screening, library, scoring, internal-mutations]

requires:
  - phase: 76-scoring-engine-rating-logic
    provides: scorePaper pure function and scoring types
  - phase: 75-schema-job-infrastructure
    provides: screeningJobs/screeningResults tables, validators, public mutations/queries
provides:
  - Internal queries (getJobInternal, getPendingResults) for workflow background context
  - Internal mutations (updateJobStatus, enqueueScreeningPaper, saveQualifiedPaperToLibrary, addToCollectionInternal, finalizeScreeningJobIfDone, setJobWorkflowId)
  - handleScreeningComplete onComplete handler for workpool post-processing
  - screenPaperAction stub for type generation
affects: [77-02-workflow, screening-ui]

tech-stack:
  added: []
  patterns: [defineOnComplete with Doc type casting for typed DB access, decodeQuestionResponseMap for encoded question keys]

key-files:
  created:
    - convex/screening/workpoolActions.ts
  modified:
    - convex/screening/queries.ts
    - convex/screening/mutations.ts

key-decisions:
  - "Store confidence in aiMetadata.confidence (schema-aligned) rather than top-level field"
  - "Cast ctx.db.get results as Doc<T> in defineOnComplete handler (workpool ctx has generic Value types)"
  - "Created workpoolActions.ts stub with internalAction for type generation (Plan 02 implements)"

patterns-established:
  - "onComplete handler pattern: load job fresh as Doc<T>, check terminal status, process, call finalizeJobIfDone"
  - "Internal mutation mirroring public mutation pattern: same logic without requireAuth, using userId arg"

requirements-completed: [JOB-05, LIB-01, LIB-02, LIB-03]

duration: 5min
completed: 2026-03-09
---

# Phase 77 Plan 01: Internal Data Layer Summary

**Internal queries and mutations for screening workflow: job loading, paper enqueuing, scoring-based library save with upsert, collection add, and workpool onComplete handler**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-09T01:10:00Z
- **Completed:** 2026-03-09T01:15:17Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added getJobInternal and getPendingResults internal queries for background workflow context
- Added 7 internal mutations including onComplete handler that scores papers, saves qualifying papers to library with star ratings, adds to collections, and finalizes jobs
- All 67 screening tests pass, zero type errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add internal queries for workflow context** - `4534e79` (feat)
2. **Task 2: Add internal mutations and onComplete handler** - `c29ae74` (feat)

## Files Created/Modified
- `convex/screening/queries.ts` - Added getJobInternal and getPendingResults internalQuery functions
- `convex/screening/mutations.ts` - Added updateJobStatus, enqueueScreeningPaper, saveQualifiedPaperToLibrary, addToCollectionInternal, finalizeScreeningJobIfDone, setJobWorkflowId, handleScreeningComplete
- `convex/screening/workpoolActions.ts` - Stub screenPaperAction for type generation (Plan 02 implements)

## Decisions Made
- Used `Doc<"screeningJobs">` type cast in defineOnComplete handler because workpool ctx.db.get returns generic Value types
- Created workpoolActions.ts stub to unblock type generation -- Plan 02 will implement the actual AI screening action
- Stored AI confidence in `aiMetadata.confidence` to match existing schema structure rather than a top-level field

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created workpoolActions.ts stub for type generation**
- **Found during:** Task 2
- **Issue:** `internal.screening.workpoolActions.screenPaperAction` reference caused type error because no workpoolActions module existed
- **Fix:** Created stub file with placeholder internalAction so Convex can generate types
- **Files modified:** convex/screening/workpoolActions.ts
- **Verification:** `npx convex dev --once` succeeds, `npx tsc --noEmit` passes
- **Committed in:** c29ae74 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for type generation. Stub will be replaced in Plan 02.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All internal mutations and queries are in place for Plan 02 (workflow integration)
- screenPaperAction stub needs real implementation in Plan 02
- handleScreeningComplete is fully wired and ready to process workpool results

---
*Phase: 77-workflow-processing-library-integration*
*Completed: 2026-03-09*
