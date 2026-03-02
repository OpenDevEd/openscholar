---
phase: 36-type-safety-sweep
plan: 01
subsystem: api
tags: [typescript, convex, type-safety, MutationCtx, QueryCtx, ActionCtx]

# Dependency graph
requires:
  - phase: 35-quick-wins
    provides: "Clean codebase baseline with debug gating and dead code removed"
provides:
  - "Properly typed ctx parameters in all extraction helper functions"
  - "Typed patchData as Partial<Doc<'extractionPapers'>>"
  - "Zero (q: any) casts in extraction module .withIndex() callbacks"
affects: [36-02, 38-extraction-mutations-refactor, 40-extraction-tests]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Import type MutationCtx/QueryCtx/ActionCtx from _generated/server for helper functions"]

key-files:
  created: []
  modified:
    - convex/extraction/mutations.ts
    - convex/extraction/queries.ts
    - convex/extraction/workpoolActions.ts
    - convex/extraction/test_helpers.ts

key-decisions:
  - "Used replace_all for (q: any) removal since TypeScript infers correct index builder types from .withIndex() generics"

patterns-established:
  - "Import ctx types from _generated/server for standalone helper functions outside mutation/query handler scope"

requirements-completed: [TYPE-01, TYPE-02, TYPE-03, TYPE-06]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 36 Plan 01: Extraction Module Type Safety Summary

**Replaced all ctx: any with MutationCtx/QueryCtx/ActionCtx across 4 extraction files, removed (q: any) casts, and typed patchData**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T07:25:42Z
- **Completed:** 2026-03-02T07:28:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced `ctx: any` with `MutationCtx` in mutations.ts (assertJobOwnership, loadJobDataForReporting) and test_helpers.ts (getOrCreateTestUser, cleanupTestData)
- Replaced `ctx: any` with `QueryCtx` in queries.ts (resolveOwnedJob, resolveOwnedPaper, attachReviewMetadata, loadJobPapersAndResults)
- Replaced `ctx: any` with `ActionCtx` in workpoolActions.ts (runDenseSearch, resolvePdfBlob)
- Removed all `(q: any)` casts in `.withIndex()` callbacks across all 4 files (15 total occurrences)
- Typed `patchData` as `Partial<Doc<"extractionPapers">>` instead of `any` in mutations.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Type extraction mutations and queries ctx parameters** - `efe779c` (feat)
2. **Task 2: Type workpoolActions and test_helpers, run full test suite** - `950fafa` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `convex/extraction/mutations.ts` - Added MutationCtx type for 2 helpers, removed 4 (q: any) casts, typed patchData
- `convex/extraction/queries.ts` - Added QueryCtx type for 4 helpers, removed 4 (q: any) casts
- `convex/extraction/workpoolActions.ts` - Added ActionCtx type for 2 helpers
- `convex/extraction/test_helpers.ts` - Added MutationCtx type for 2 helpers, removed 4 (q: any) casts

## Decisions Made
- Used `replace_all` for `(q: any)` removal since TypeScript correctly infers index builder types from the `.withIndex()` generics -- no explicit type annotation needed on the callback parameter

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All extraction helper functions now have proper ctx typing
- Ready for 36-02 (remaining type safety work in other modules)
- The extraction/mutations.ts file is properly typed for phases 38 and 40 which will also modify it

## Self-Check: PASSED

All 4 modified files exist. Both task commits (efe779c, 950fafa) verified in git log.

---
*Phase: 36-type-safety-sweep*
*Completed: 2026-03-02*
