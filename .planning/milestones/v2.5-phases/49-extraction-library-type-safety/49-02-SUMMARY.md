---
phase: 49-extraction-library-type-safety
plan: 02
subsystem: database
tags: [convex, validators, type-safety, pagination, search-filters]

# Dependency graph
requires:
  - phase: 49-extraction-library-type-safety
    provides: "Typed extraction validators and castless document shapes (plan 01)"
provides:
  - "searchFiltersValidator -- typed v.object replacing v.record(v.string(), v.any()) across 6 files"
  - "paginatedPaperWithResultsValidator -- typed pagination item replacing paginationResultValidator(v.any())"
  - "Zero v.any() remaining in extraction searchFilters and pagination validators"
affects: [extraction-queries, extraction-mutations, extraction-actions, schema]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Shared typed Convex validators imported from validators.ts into schema.ts, queries, mutations, actions"]

key-files:
  created: []
  modified:
    - convex/extraction/validators.ts
    - convex/extraction/queries.ts
    - convex/extraction/mutations.ts
    - convex/extraction/actions.ts
    - convex/schema.ts
    - lib/types/extraction.types.ts

key-decisions:
  - "All searchFiltersValidator fields are v.optional() to maintain backward compatibility with existing stored data"
  - "searchFiltersValidator placed before extractionJobValidator in validators.ts to avoid 'used before declaration' errors"

patterns-established:
  - "Shared validator pattern: define typed validators in validators.ts, import into schema.ts and all consumer files"

requirements-completed: [TYPE-03, TYPE-04]

# Metrics
duration: 7min
completed: 2026-03-03
---

# Phase 49 Plan 02: Typed Search Filters and Pagination Validators Summary

**Typed searchFiltersValidator replacing 14 v.record(v.string(), v.any()) occurrences and paginatedPaperWithResultsValidator replacing paginationResultValidator(v.any()) for extraction results**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-03T08:34:26Z
- **Completed:** 2026-03-03T08:41:40Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Defined `searchFiltersValidator` with 20 all-optional fields matching the actual stored filter shape
- Defined `paginatedPaperWithResultsValidator` combining paper fields + typed results array
- Replaced all 14 `v.record(v.string(), v.any())` occurrences for searchFilters across schema, validators, queries, mutations, and actions
- Replaced `paginatedAnyResultValidator` with typed `paginatedPaperResultValidator` in getJobResultsPaginated
- Updated frontend types from `Record<string, any>` to `Record<string, unknown>`

## Task Commits

Each task was committed atomically:

1. **Task 1: Define typed searchFiltersValidator and paginatedPaperWithResultsValidator** - `0d8f630` (feat)
2. **Task 2: Replace all v.record(v.string(), v.any()) and paginatedAnyResultValidator usages** - `bb082d1` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `convex/extraction/validators.ts` - Added searchFiltersValidator and paginatedPaperWithResultsValidator, replaced self-references
- `convex/extraction/queries.ts` - Replaced paginatedAnyResultValidator and 3 searchFilters occurrences
- `convex/extraction/mutations.ts` - Replaced 5 searchFilters occurrences across startExtraction, saveWorkflowTemplate, createJobDirect
- `convex/extraction/actions.ts` - Replaced 1 searchFilters occurrence in fetchPapersFromHistory
- `convex/schema.ts` - Replaced 3 searchFilters occurrences in extractionJobs and extractionWorkflowTemplates tables
- `lib/types/extraction.types.ts` - Updated ExtractionHistorySource and CreateExtractionJobInput to use Record<string, unknown>

## Decisions Made
- All searchFiltersValidator fields are `v.optional()` to ensure backward compatibility with existing stored data that may be missing fields
- Moved searchFiltersValidator before extractionJobValidator in validators.ts to fix "used before declaration" error (extractionJobValidator references it inline)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed searchFiltersValidator declaration order in validators.ts**
- **Found during:** Task 2 verification
- **Issue:** searchFiltersValidator was placed after extractionResultWithReviewValidator (per plan instruction to place after it) but extractionJobValidator (defined earlier in file) references it, causing "used before declaration" TS errors
- **Fix:** Moved searchFiltersValidator before the "Full document validators" section, ensuring it's declared before extractionJobValidator
- **Files modified:** convex/extraction/validators.ts
- **Verification:** TypeScript compilation passes with zero errors in extraction files
- **Committed in:** bb082d1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Declaration order fix necessary for TypeScript correctness. No scope creep.

## Issues Encountered
None beyond the declaration order issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TYPE-03 and TYPE-04 requirements complete
- All extraction validators now fully typed -- zero v.any() in searchFilters or pagination
- Ready for next phase in v2.5 Tech Debt Purge roadmap

---
*Phase: 49-extraction-library-type-safety*
*Completed: 2026-03-03*
