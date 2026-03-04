---
phase: quick-3
plan: 01
subsystem: extraction
tags: [grobid, pdfjs, cheerio, cleanup]

# Dependency graph
requires: []
provides:
  - "Clean extraction pipeline using only PDF.js (no GROBID dependency)"
  - "Simplified buildEvidenceUnitsFromPdf without GROBID fallback logic"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PDF.js-only extraction: all evidence units built via pdfjs_chunks path"

key-files:
  created: []
  modified:
    - convex/extraction/workpoolActions.ts
    - convex/extraction/evidence_units.ts
    - convex/_generated/api.d.ts
    - package.json

key-decisions:
  - "Manually removed grobid references from convex/_generated/api.d.ts since convex codegen has a pre-existing failure unrelated to this task"
  - "Changed default source in buildAnchoredEvidenceUnits from grobid to pdfjs_chunks"

patterns-established: []

requirements-completed: [QUICK-3]

# Metrics
duration: 2min
completed: 2026-03-04
---

# Quick Task 3: Remove GROBID Implementation Summary

**Removed GROBID PDF parsing service, cheerio dependency, and all references -- extraction now uses PDF.js-only path**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-04T09:34:06Z
- **Completed:** 2026-03-04T09:36:32Z
- **Tasks:** 2
- **Files modified:** 7 (4 deleted/modified in task 1, 3 modified in task 2)

## Accomplishments
- Deleted grobid.ts (199 lines) and grobid-fallback.test.ts entirely
- Removed grobid import, getSectionsByPage function, and grobid try/catch from workpoolActions.ts
- Simplified buildEvidenceUnitsFromPdf to use PDF.js path directly without GROBID fallback
- Removed "grobid" from AnchoredEvidenceUnit source type union
- Removed cheerio dependency from package.json
- All 780 tests pass across 81 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove grobid files, imports, and usage** - `c569195` (feat)
2. **Task 2: Remove cheerio dependency and verify tests** - `d20c59e` (chore)

## Files Created/Modified
- `convex/extraction/grobid.ts` - DELETED (199 lines of GROBID XML parsing via cheerio)
- `tests/grobid-fallback.test.ts` - DELETED (grobid fallback test)
- `convex/extraction/workpoolActions.ts` - Removed grobid import, getSectionsByPage function, grobid try/catch block; simplified buildEvidenceUnitsFromPdf
- `convex/extraction/evidence_units.ts` - Removed "grobid" from source type union; changed default source to "pdfjs_chunks"
- `convex/_generated/api.d.ts` - Removed grobid import and module reference
- `package.json` - Removed cheerio dependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Manually edited convex/_generated/api.d.ts to remove grobid references since `npx convex codegen` has a pre-existing failure (node:crypto resolution error in crypto.ts) unrelated to this task
- Changed buildAnchoredEvidenceUnits default source from "grobid" to "pdfjs_chunks" since grobid is no longer a valid source

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Manually removed grobid references from api.d.ts**
- **Found during:** Task 2 (convex codegen step)
- **Issue:** `npx convex codegen` fails due to pre-existing node:crypto resolution error in convex/lib/crypto.ts, preventing automatic regeneration
- **Fix:** Manually removed the grobid import line and module map entry from convex/_generated/api.d.ts
- **Files modified:** convex/_generated/api.d.ts
- **Verification:** grep confirms no grobid references remain anywhere in convex/, tests/, or src/
- **Committed in:** d20c59e (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Manual api.d.ts edit achieves same result as codegen would have. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in convex/ (audit, envValidation component references) confirmed unrelated to grobid removal
- Pre-existing convex codegen failure (node:crypto) prevented automatic type regeneration -- handled via manual edit

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Extraction pipeline is cleaner and simpler
- No GROBID infrastructure needed for deployment
- All tests pass

---
*Quick Task: 3-get-rid-of-the-grobid-implementation-ent*
*Completed: 2026-03-04*
