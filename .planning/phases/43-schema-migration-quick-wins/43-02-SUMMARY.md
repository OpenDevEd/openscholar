---
phase: 43-schema-migration-quick-wins
plan: 02
subsystem: security
tags: [debug-gate, openalex, jsdoc, dead-code, env-var]

# Dependency graph
requires: []
provides:
  - JSDoc policy annotations on all 17 debug/test gated functions across 12 files
  - Configurable OpenAlex User-Agent email via OPENALEX_CONTACT_EMAIL env var
  - Removed orphaned /test-sidebar page
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JSDoc @production STAGING ONLY annotation pattern for debug-gated functions"
    - "OPENALEX_CONTACT_EMAIL env var with nullish coalescing fallback"

key-files:
  created: []
  modified:
    - convex/extraction/actions.ts
    - convex/lib/debug_gate.ts
    - convex/extraction/debug.ts
    - convex/extraction/debug_errors.ts
    - convex/extraction/debug_papers.ts
    - convex/extraction/debug_paper_results.ts
    - convex/extraction/debug_job_content.ts
    - convex/extraction/debug_job_citations.ts
    - convex/extraction/debug_pdfjs_alignment.ts
    - convex/extraction/test_runner.ts
    - convex/extraction/test_automation.ts
    - convex/extraction/test_automation_internal.ts
    - convex/extraction/testActions.ts
    - convex/extraction/create_test_job.ts

key-decisions:
  - "Used nullish coalescing (??) for OPENALEX_CONTACT_EMAIL fallback to preserve backward compatibility"
  - "Cleared .next/types cache after test-sidebar deletion to remove stale generated type reference"

patterns-established:
  - "JSDoc @production annotation: All debug/test functions gated by requirePublicDebugEnabled() must have @production STAGING ONLY JSDoc with gate and access documentation"

requirements-completed: [SEC-04, SEC-05, BUG-05]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 43 Plan 02: Housekeeping Summary

**Deleted orphaned test-sidebar page, replaced hardcoded OpenAlex email with OPENALEX_CONTACT_EMAIL env var, and added @production JSDoc policy annotations to all 17 debug/test gated functions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T21:33:08Z
- **Completed:** 2026-03-02T21:37:01Z
- **Tasks:** 2
- **Files modified:** 15 (1 deleted, 14 modified)

## Accomplishments
- SEC-05: Deleted orphaned /test-sidebar page (dead code, no references in codebase)
- BUG-05: Replaced hardcoded admin@example.com with OPENALEX_CONTACT_EMAIL env var for OpenAlex polite pool identification
- SEC-04: Added @production STAGING ONLY JSDoc annotations to all 17 gated functions across 12 debug/test files, plus module-level documentation on debug_gate.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete test-sidebar page and replace placeholder email** - `0913930` (feat)
2. **Task 2: Add JSDoc policy annotations to all debug/test endpoints** - `920e09f` (docs)

## Files Created/Modified
- `app/test-sidebar/page.tsx` - DELETED: orphaned test page with no references
- `convex/extraction/actions.ts` - User-Agent now uses OPENALEX_CONTACT_EMAIL env var with fallback
- `convex/lib/debug_gate.ts` - Module-level JSDoc documenting debug gate policy
- `convex/extraction/debug.ts` - @production annotation on diagnoseJob
- `convex/extraction/debug_errors.ts` - @production annotation on getFailedPapersDebug
- `convex/extraction/debug_papers.ts` - @production annotation on getPaperErrorsInternal
- `convex/extraction/debug_paper_results.ts` - @production annotation on debugPaperResults
- `convex/extraction/debug_job_content.ts` - @production annotation on debugJobContent
- `convex/extraction/debug_job_citations.ts` - @production annotation on debugJobCitations
- `convex/extraction/debug_pdfjs_alignment.ts` - @production annotation on debugPdfAlignment
- `convex/extraction/test_runner.ts` - @production annotations on createAndRunTestJob and getTestJobStatus
- `convex/extraction/test_automation.ts` - @production annotation on runPdfTestNow
- `convex/extraction/test_automation_internal.ts` - @production annotations on getFirstUserId, createTestJob, getJobStatus, getJobResults
- `convex/extraction/testActions.ts` - @production annotation on createTestJob
- `convex/extraction/create_test_job.ts` - @production annotation on createTestJobForFix

## Decisions Made
- Used nullish coalescing (`??`) for OPENALEX_CONTACT_EMAIL fallback to preserve backward compatibility for deployments without the env var set
- Cleared .next/types cache after deleting test-sidebar to remove stale auto-generated type reference

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Cleared .next/types cache after test-sidebar deletion**
- **Found during:** Task 1 (verification step)
- **Issue:** Next.js auto-generated validator.ts still referenced the deleted test-sidebar page, causing a TS2307 error
- **Fix:** Removed .next/types directory so Next.js regenerates it without the stale reference
- **Files modified:** .next/types/ (cache, not committed)
- **Verification:** npx tsc --noEmit shows only the 3 pre-existing test file errors
- **Committed in:** Not committed (cache cleanup only)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cache cleanup was necessary for clean verification. No scope creep.

## Issues Encountered
None beyond the .next/types cache issue noted above.

## User Setup Required

After deployment, set the `OPENALEX_CONTACT_EMAIL` environment variable in the Convex dashboard to a real, monitored email address. This enables OpenAlex polite pool prioritization.

## Next Phase Readiness
- All SEC-04, SEC-05, and BUG-05 requirements complete
- Codebase cleaner: no orphaned test page, all debug endpoints documented
- Ready for Phase 43 Plan 01 (schema migration) or next phase

## Self-Check: PASSED

- SUMMARY.md: FOUND
- Commit 0913930 (Task 1): FOUND
- Commit 920e09f (Task 2): FOUND

---
*Phase: 43-schema-migration-quick-wins*
*Completed: 2026-03-02*
