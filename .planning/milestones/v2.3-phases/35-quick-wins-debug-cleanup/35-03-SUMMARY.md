---
phase: 35-quick-wins-debug-cleanup
plan: 03
subsystem: extraction
tags: [dead-code-removal, debug-gating, security, convex]

# Dependency graph
requires: []
provides:
  - "Clean extraction module with no V32 version gating code"
  - "Extraction module with no legacy backfill mutations"
  - "All debug/test functions gated behind requirePublicDebugEnabled()"
affects: [36-extraction-hardening, 38-extraction-mutations-split, 40-extraction-test-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requirePublicDebugEnabled() as first line in all debug/test handlers"

key-files:
  created: []
  modified:
    - convex/extraction/workpoolActions.ts
    - convex/extraction/mutations.ts
    - convex/extraction/index.ts
    - convex/extraction/debug_papers.ts
    - convex/extraction/debug_paper_results.ts
    - convex/extraction/debug_job_content.ts
    - convex/extraction/debug_job_citations.ts
    - convex/extraction/debug_pdfjs_alignment.ts
    - convex/extraction/test_automation.ts
    - convex/extraction/test_automation_internal.ts
    - convex/extraction/test_runner.ts

key-decisions:
  - "Gate all debug/test handlers at function entry with requirePublicDebugEnabled() for consistent security enforcement"

patterns-established:
  - "Debug gate pattern: every debug/test handler in extraction/ must call requirePublicDebugEnabled() as first statement"

requirements-completed: [SEC-04, DATA-04, DATA-05]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 35 Plan 03: Dead Code Removal & Debug Gating Summary

**Deleted V32_CUTOVER_AT version gating, 4 legacy backfill mutations (~260 lines), and gated all 12 debug/test handlers behind requirePublicDebugEnabled()**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T06:54:02Z
- **Completed:** 2026-03-02T06:57:42Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Removed all V32_CUTOVER_AT version gating code from workpoolActions.ts (constant, function, 2 guard blocks)
- Deleted 4 legacy backfill mutations from mutations.ts: backfillIsIndexed, backfillProcessable, resetExtractionMvpData, purgeLegacyExtractionRowsBatch
- Gated 12 debug/test handler functions across 8 files behind requirePublicDebugEnabled()
- Typecheck passes cleanly with zero errors related to changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete V32_CUTOVER_AT code and legacy backfill mutations** - `ca16050` (feat)
2. **Task 2: Gate all debug/test functions behind requirePublicDebugEnabled()** - `1bcc594` (feat)

## Files Created/Modified
- `convex/extraction/workpoolActions.ts` - Removed V32_CUTOVER_AT constant, isV32EnabledForJob function, and 2 guard blocks
- `convex/extraction/mutations.ts` - Deleted backfillIsIndexed, backfillProcessable, resetExtractionMvpData, purgeLegacyExtractionRowsBatch
- `convex/extraction/index.ts` - Removed 4 deleted mutation exports from barrel file
- `convex/extraction/debug_papers.ts` - Added requirePublicDebugEnabled() gate to getPaperErrorsInternal
- `convex/extraction/debug_paper_results.ts` - Added requirePublicDebugEnabled() gate to debugPaperResults
- `convex/extraction/debug_job_content.ts` - Added requirePublicDebugEnabled() gate to debugJobContent
- `convex/extraction/debug_job_citations.ts` - Added requirePublicDebugEnabled() gate to debugJobCitations
- `convex/extraction/debug_pdfjs_alignment.ts` - Added requirePublicDebugEnabled() gate to debugPdfAlignment
- `convex/extraction/test_automation.ts` - Added requirePublicDebugEnabled() gate to runPdfTestNow
- `convex/extraction/test_automation_internal.ts` - Added requirePublicDebugEnabled() gate to all 4 functions
- `convex/extraction/test_runner.ts` - Added requirePublicDebugEnabled() gate to createAndRunTestJob and getTestJobStatus

## Decisions Made
- Gate all debug/test handlers at function entry (not module level) for consistent security enforcement per Convex handler pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Extraction module is now clean of dead V32 gating code and legacy backfill mutations
- All debug/test paths are consistently gated, ready for Phase 36 extraction hardening
- mutations.ts reduced by ~260 lines, easing future Phase 38 extraction-mutations-split work

## Self-Check: PASSED

All 11 modified files exist. Both task commits (ca16050, 1bcc594) verified. Summary file exists.

---
*Phase: 35-quick-wins-debug-cleanup*
*Completed: 2026-03-02*
