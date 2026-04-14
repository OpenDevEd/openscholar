---
phase: 88-scorched-earth-teardown
plan: 03
subsystem: teardown
tags: [deletion, extraction, cleanup, backend, schema, convex]

# Dependency graph
requires: [88-02]
provides:
  - "convex/extraction/ directory deleted (32 files, ~9,610 LoC)"
  - "All 11 extraction tables removed from convex/schema.ts"
  - "searchFiltersValidator import removed from convex/schema.ts"
  - "All 6 shared Convex modules cleaned of extraction references"
  - "Convex types regenerated with zero extraction references"
  - "tsc --noEmit passes with zero errors"
affects: [88-04]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - convex/maintenance/mutations.ts
    - convex/ai/actions.ts
    - convex/lib/rateLimit.ts
    - convex/featureFlags/internal.ts
    - convex/lib/constants.ts
    - convex/lib/queryBounds.ts
    - convex/schema.ts
    - convex/_generated/api.d.ts
    - tests/ai-prompts.test.ts
    - tests/ai-schemas.test.ts

key-decisions:
  - "Removed extraction cascade delete block from maintenance/mutations.ts, preserved internal import for self-scheduling"
  - "Removed extraction test blocks from ai-prompts.test.ts and ai-schemas.test.ts (shared test files with stale extraction imports)"

patterns-established: []

requirements-completed: [TEAR-01, TEAR-02, TEAR-10]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 88 Plan 03: Backend Extraction Teardown and Schema Cleanup Summary

**Deleted convex/extraction/ (32 files, ~9,610 LoC), surgically cleaned 6 shared Convex modules, removed all 11 extraction tables from schema.ts, and regenerated Convex types to zero extraction references**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-14T23:19:11Z
- **Completed:** 2026-04-14T23:26:55Z
- **Tasks:** 2 (+ 1 deviation fix across 2 test files)
- **Files modified:** 42 (32 deleted + 10 edited)

## Accomplishments
- Deleted `convex/extraction/` directory entirely (32 files, ~9,610 LoC of backend extraction code)
- Removed extraction job cascade delete block from `convex/maintenance/mutations.ts` (preserved `internal` import for self-scheduling)
- Removed `generateExtractionQuestions` action and `getExtractionQuestionsConfig` import from `convex/ai/actions.ts`
- Removed `start-extraction` rate limit key and validator literal from `convex/lib/rateLimit.ts`
- Removed 7 `extraction.*` feature flag seeds from `convex/featureFlags/internal.ts`
- Removed extraction JSDoc references from `convex/lib/constants.ts`
- Removed 3 extraction query bound constants from `convex/lib/queryBounds.ts`
- Removed `searchFiltersValidator` import from `convex/schema.ts`
- Removed all 11 extraction table definitions from `convex/schema.ts` (extractionJobs, extractionQuestions, extractionPapers, extractionEvidenceUnits, extractionResults, extractionResultReviews, extractionSavedViews, extractionWorkflowTemplates, extractionReportSnapshots, extractionJobStats, extractionRunDiffs)
- Regenerated `convex/_generated/api.d.ts` via `npx convex codegen` with zero extraction references
- TypeScript compilation passes with zero errors (`tsc --noEmit` clean)

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete convex/extraction/ and clean extraction refs from shared Convex modules** - `31669b7` (feat) -- 32 files deleted + 6 files edited, ~9,678 lines removed
2. **Task 2: Remove 11 extraction tables from schema and regenerate Convex types** - `f436a2e` (feat) -- 4 files edited, ~621 lines removed

## Files Created/Modified
- `convex/extraction/` -- Deleted (32 files: mutations, queries, actions, workflow, workpoolActions, prompts, validators, chunking, guard, pdfjs_extract, debug_*, test_*, types, uploads, index)
- `convex/maintenance/mutations.ts` -- Extraction cascade delete block removed (lines 38-54)
- `convex/ai/actions.ts` -- `generateExtractionQuestions` action and import removed
- `convex/lib/rateLimit.ts` -- `start-extraction` key and validator literal removed
- `convex/featureFlags/internal.ts` -- 7 extraction feature flag seeds removed
- `convex/lib/constants.ts` -- Extraction JSDoc references removed from 2 constants
- `convex/lib/queryBounds.ts` -- 3 extraction constants removed, screening comment simplified
- `convex/schema.ts` -- `searchFiltersValidator` import and all 11 extraction tables removed
- `convex/_generated/api.d.ts` -- Regenerated with zero extraction references
- `tests/ai-prompts.test.ts` -- Extraction import and test block removed (deviation)
- `tests/ai-schemas.test.ts` -- Extraction import and test block removed (deviation)

## Decisions Made
- Removed extraction cascade block from maintenance mutations: extraction tables no longer exist, nothing to cascade-delete. `internal` import preserved for `internal.maintenance.mutations.cleanupDeletedUsers` self-scheduling.
- Removed extraction test blocks from shared AI test files: `tests/ai-prompts.test.ts` and `tests/ai-schemas.test.ts` imported extraction symbols that were already deleted from `lib/ai/core/`. Non-extraction tests preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed extraction test blocks from tests/ai-prompts.test.ts and tests/ai-schemas.test.ts**
- **Found during:** Task 2 (TypeScript compilation check)
- **Issue:** Both test files imported `buildExtractionQuestionsPrompts` and `extractionQuestionsSchema` from `lib/ai/core/prompts` and `lib/ai/core/schemas` respectively. These exports were removed by Plan 02, but the test files were not in Plan 01/02's scope (they test AI core modules, not extraction-specific test files). The stale imports caused `tsc --noEmit` to fail.
- **Fix:** Removed extraction import from both files and deleted the `describe("buildExtractionQuestionsPrompts")` and `describe("extractionQuestionsSchema")` test blocks. All non-extraction tests preserved.
- **Files modified:** tests/ai-prompts.test.ts, tests/ai-schemas.test.ts
- **Committed in:** f436a2e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for tsc --noEmit to pass. No scope creep -- stayed within extraction teardown boundary.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None -- this plan is purely destructive deletion and surgical editing with no new code.

## Threat Flags

None found. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries were introduced (this plan only removes code).

## Self-Check: PASSED

All claims verified:
- SUMMARY.md exists on disk
- Task 1 commit `31669b7` found in git log
- Task 2 commit `f436a2e` found in git log
- `convex/extraction/` directory confirmed deleted
- Zero extraction references in `convex/schema.ts`
- `screeningJobs` preserved in schema (2 references)
- Zero extraction references in all 6 shared Convex modules
- `tsc --noEmit` passes with zero errors

## Next Phase Readiness
- All extraction backend code deleted, schema cleaned, types regenerated
- Plan 04 handles remaining teardown: convex.config.ts (RAG + workpool), package.json (dependency uninstall), i18n cleanup, and final verification

---
*Phase: 88-scorched-earth-teardown*
*Completed: 2026-04-15*
