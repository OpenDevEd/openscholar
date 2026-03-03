---
phase: 45-type-safety-sweep
plan: 01
subsystem: api
tags: [typescript, convex, validators, type-safety, extraction]

# Dependency graph
requires:
  - phase: none
    provides: n/a
provides:
  - Shared extraction validators (convex/extraction/validators.ts) with 18 typed exports
  - Type-safe attachReviewMetadata with ResultWithReview type
  - Elimination of all as-any casts in extraction queries and mutations
  - BUG-02 fix -- getJobDetails returns all papers (no .take(100) cap)
  - Typed migrateSearchHistoryState with SearchHistoryPersistedState interface
affects: [45-type-safety-sweep plan 02 (query return typing)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ResultWithReview type pattern for Doc + review overlay
    - InsightRow local type alias for typed report generation
    - SearchHistoryPersistedState interface with Record<string, unknown> migration items

key-files:
  created:
    - convex/extraction/validators.ts
  modified:
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts
    - lib/store.ts

key-decisions:
  - "Keep migrateSearchHistoryState external signature as any for Zustand persist compatibility, use internal type assertion"
  - "Use ResultWithReview intersection type (Doc & overlay) rather than separate interface to preserve Doc fields"
  - "Use DisagreementCluster[] for clusters variable instead of any[] (bonus cleanup)"

patterns-established:
  - "ResultWithReview: Doc<'extractionResults'> & review overlay for typed access after attachReviewMetadata"
  - "InsightRow: local type alias for insight aggregation rows with question, aggregate, disagreements, entries"

requirements-completed: [TYPE-01, TYPE-03, TYPE-04, BUG-02]

# Metrics
duration: 5min
completed: 2026-03-03
---

# Phase 45 Plan 01: Extraction Validators and Type Safety Summary

**18 shared extraction validators, all as-any casts eliminated from queries/mutations, BUG-02 paper cap fixed, store migration typed**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-03T05:35:36Z
- **Completed:** 2026-03-03T05:41:32Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `convex/extraction/validators.ts` with 18 typed validator exports matching schema exactly
- Eliminated all `as any` casts in queries.ts (was 10+, now 0) and mutations.ts (was 8+, now only `workflowId as any` which is out of scope)
- Fixed BUG-02: replaced `.take(100)` with `.collect()` in getJobDetails so all papers are returned
- Typed `migrateSearchHistoryState` with `SearchHistoryPersistedState` interface and `Record<string, unknown>` migration items

## Task Commits

Each task was committed atomically:

1. **Task 1: Create extraction validators and fix as-any casts** - `5fdc358` (feat)
2. **Task 2: Type migrateSearchHistoryState migration function** - `783ca37` (feat)

## Files Created/Modified
- `convex/extraction/validators.ts` - New file with 18 shared extraction validators matching schema definitions
- `convex/extraction/queries.ts` - Typed attachReviewMetadata, ResultWithReview type, removed all as-any casts, BUG-02 fix
- `convex/extraction/mutations.ts` - Removed as-any casts for citationStatus, reviewState, question.type; added InsightRow type
- `lib/store.ts` - Added SearchHistoryPersistedState interface, replaced all (item: any) with Record<string, unknown>

## Decisions Made
- Kept `migrateSearchHistoryState` external signature as `any` for Zustand persist `migrate` option compatibility, using internal `as SearchHistoryPersistedState` assertion
- Used `ResultWithReview` intersection type (`Doc<"extractionResults"> & { overlay fields }`) to preserve all Doc fields while adding review overlay
- Cleaned up `clusters: any[]` to `clusters: DisagreementCluster[]` as bonus type safety (beyond plan scope but directly related)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Typed clusters variable in getQuestionDisagreements**
- **Found during:** Task 1 (queries.ts cleanup)
- **Issue:** `let clusters: any[]` was an unnecessary any that could be typed since both code paths produce `DisagreementCluster[]`
- **Fix:** Changed to `let clusters: DisagreementCluster[]` and imported the type
- **Files modified:** convex/extraction/queries.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 5fdc358 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Minor bonus cleanup directly related to the as-any elimination scope. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Extraction validators foundation ready for Plan 02 (query return typing with `v.any()` replacement)
- `ResultWithReview` type enables Plan 02 to replace `v.any()` return validators with proper typed validators
- All existing tests pass (9/9 store migration tests, 0 new TypeScript errors)

---
*Phase: 45-type-safety-sweep*
*Completed: 2026-03-03*
