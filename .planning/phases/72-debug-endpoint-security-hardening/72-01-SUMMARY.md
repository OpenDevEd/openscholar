---
phase: 72-debug-endpoint-security-hardening
plan: 01
subsystem: security
tags: [convex, internalQuery, internalMutation, debug-functions]

requires: []
provides:
  - "All 12 debug/test Convex functions use internal registration exclusively"
  - "debug_gate.ts module deleted (no more env-var gating)"
  - "Static analysis test verifying internal registration for all debug files"
affects: [73-audit-logging, 74-counter-field]

tech-stack:
  added: []
  patterns: ["Internal function registration as security boundary (no runtime gate needed)"]

key-files:
  created:
    - tests/debug-internal.test.ts
  modified:
    - convex/extraction/debug.ts
    - convex/extraction/debug_errors.ts
    - convex/extraction/testActions.ts
    - convex/extraction/create_test_job.ts
    - convex/extraction/debug_papers.ts
    - convex/extraction/debug_paper_results.ts
    - convex/extraction/debug_job_content.ts
    - convex/extraction/debug_job_citations.ts
    - convex/extraction/debug_pdfjs_alignment.ts
    - convex/extraction/test_runner.ts
    - convex/extraction/test_automation.ts
    - convex/extraction/test_automation_internal.ts

key-decisions:
  - "Removed ownership checks from debug.ts and debug_errors.ts -- internal callers are trusted"
  - "Added userId argument to testActions.ts and create_test_job.ts to replace requireAuth user lookup"

patterns-established:
  - "Debug functions use internalQuery/internalMutation/internalAction -- platform-enforced unreachability replaces runtime env-var gates"

requirements-completed: [SEC-01, SEC-03]

duration: 6min
completed: 2026-03-06
---

# Phase 72 Plan 01: Debug Endpoint Security Hardening Summary

**Converted 4 public debug functions to internalQuery/internalMutation, removed requirePublicDebugEnabled from all 12 files, deleted debug_gate.ts**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-06T07:18:57Z
- **Completed:** 2026-03-06T07:24:52Z
- **Tasks:** 2
- **Files modified:** 14 (12 converted + 2 deleted)

## Accomplishments
- Converted 4 public query/mutation functions to internal registration (eliminates client SDK access)
- Removed requirePublicDebugEnabled() calls from all 12 debug files
- Deleted convex/lib/debug_gate.ts and tests/debug-gate.test.ts (dead code)
- Created tests/debug-internal.test.ts with 13 assertions verifying internal registration

## Task Commits

Each task was committed atomically:

1. **Task 1: Write replacement test (RED)** - `10b0cfe` (test)
2. **Task 2: Convert functions and strip debug gate (GREEN)** - `37e2ddb` (feat)

## Files Created/Modified
- `tests/debug-internal.test.ts` - Static analysis test verifying all 12 debug files use internal registration
- `convex/extraction/debug.ts` - query -> internalQuery, removed auth/ownership check
- `convex/extraction/debug_errors.ts` - query -> internalQuery, removed auth/ownership check
- `convex/extraction/testActions.ts` - mutation -> internalMutation, added userId arg
- `convex/extraction/create_test_job.ts` - mutation -> internalMutation, added userId arg
- `convex/extraction/debug_papers.ts` - removed requirePublicDebugEnabled
- `convex/extraction/debug_paper_results.ts` - removed requirePublicDebugEnabled
- `convex/extraction/debug_job_content.ts` - removed requirePublicDebugEnabled
- `convex/extraction/debug_job_citations.ts` - removed requirePublicDebugEnabled
- `convex/extraction/debug_pdfjs_alignment.ts` - removed requirePublicDebugEnabled
- `convex/extraction/test_runner.ts` - removed requirePublicDebugEnabled from 2 functions
- `convex/extraction/test_automation.ts` - removed requirePublicDebugEnabled
- `convex/extraction/test_automation_internal.ts` - removed requirePublicDebugEnabled from 4 functions
- `convex/lib/debug_gate.ts` - DELETED
- `tests/debug-gate.test.ts` - DELETED

## Decisions Made
- Removed ownership checks from debug.ts and debug_errors.ts -- internal callers are trusted, no auth context available
- Added explicit userId argument to testActions.ts and create_test_job.ts to replace the requireAuth user lookup pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. The ENABLE_PUBLIC_DEBUG_FUNCTIONS env var in the Convex dashboard is now dead code and can be removed at any time.

## Next Phase Readiness
- All debug functions are now internal -- ready for audit logging (Phase 73) and counter field (Phase 74) work
- TypeScript compiles cleanly, all tests pass

---
*Phase: 72-debug-endpoint-security-hardening*
*Completed: 2026-03-06*
