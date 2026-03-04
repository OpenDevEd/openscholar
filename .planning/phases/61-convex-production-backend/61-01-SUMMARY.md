---
phase: 61-convex-production-backend
plan: 01
subsystem: api
tags: [typescript, type-safety, convex, extraction]

# Dependency graph
requires:
  - phase: 60-convex-validators-typed-records
    provides: Typed validators and PaperData/ExtractionResult interfaces
provides:
  - Zero any annotations in extraction production backend files (workflow, workpoolActions, actions, mutations)
  - Properly typed extraction pipeline with PaperData, ExtractionResult, Id types
affects: [61-02, extraction-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WorkflowPaper type (PaperData + sourceType union + sourceId) for workflow accumulator"
    - "as const on string literals to preserve narrow union types in spreads"
    - "Omit + re-declare for Id<> branded type compatibility"

key-files:
  created: []
  modified:
    - convex/extraction/workflow.ts
    - convex/extraction/workpoolActions.ts
    - convex/extraction/actions.ts
    - convex/extraction/mutations.ts

key-decisions:
  - "Used WorkflowPaper = PaperData & { sourceType: SourceType; sourceId: string } with SourceType union for type-safe paper accumulation"
  - "Used as const on sourceType literals to prevent string widening in spread objects"
  - "Cast storageId to Id<'_storage'> at createPaperRecords call site (PaperData uses string, mutation expects branded Id)"
  - "Used inline types for Zotero/manual item shapes matching schema validators exactly"

patterns-established:
  - "as const pattern for preserving narrow literal types through object spreads in Convex workflows"

requirements-completed: [CONV-02]

# Metrics
duration: 7min
completed: 2026-03-04
---

# Phase 61 Plan 01: Extraction Backend Type Safety Summary

**Eliminated 13 any annotations across 4 extraction production files using PaperData, ExtractionResult, Id types, and inline shapes from schema validators**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-04T11:15:27Z
- **Completed:** 2026-03-04T11:22:38Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced all 7 any annotations in workflow.ts with WorkflowPaper type, typed question parameters, and proper PaperData spreads
- Replaced all 4 any annotations in workpoolActions.ts (parseDenseScores RAG result type, resolvePdfBlob Id types, storedId cast removal, evidence unit inference)
- Replaced 1 any in actions.ts (OpenAlex authorship mapping with inline author interface)
- Replaced 1 any in mutations.ts (ExtractionResult[] in handleExtractionComplete)

## Task Commits

Each task was committed atomically:

1. **Task 1: Type extraction workflow.ts variables and callbacks** - `7e4d8dc` (feat)
2. **Task 2: Type workpoolActions.ts, actions.ts, and mutations.ts** - `1025ae4` (feat)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `convex/extraction/workflow.ts` - Added PaperData/Id imports, WorkflowPaper type, typed all 7 any sites
- `convex/extraction/workpoolActions.ts` - Added Id import, typed parseDenseScores parameter, resolvePdfBlob args, removed as any cast, typed evidence unit map
- `convex/extraction/actions.ts` - Typed OpenAlex authorship mapping with inline author interface
- `convex/extraction/mutations.ts` - Replaced Array<any> with ExtractionResult[] in handleExtractionComplete

## Decisions Made
- Used `WorkflowPaper = PaperData & { sourceType: SourceType; sourceId: string }` for the paper accumulator and dedupe map, keeping it simple rather than per-source union types
- Used `as const` on sourceType string literals ("history", "zotero", "manual") to prevent TypeScript from widening them to `string` in spread objects
- Cast `storageId` to `Id<"_storage"> | undefined` at the `createPaperRecords` call site because `PaperData.storageId` is typed as `string` while the mutation validator expects the branded Convex ID type
- Used inline types for Zotero items and manual items matching the exact schema validators (with correct optional/required fields like `authors: string[]` for Zotero vs `authors?: string[]` for manual)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sourceType string literal widening**
- **Found during:** Task 1 (workflow.ts typing)
- **Issue:** String literals like `"history"` were widened to `string` when used in object spreads, causing type mismatch with SourceType union
- **Fix:** Added `as const` assertions on all sourceType literal values
- **Files modified:** convex/extraction/workflow.ts
- **Verification:** tsc --noEmit passes with no errors in workflow.ts
- **Committed in:** 7e4d8dc (Task 1 commit)

**2. [Rule 1 - Bug] Fixed storageId branded type mismatch**
- **Found during:** Task 1 (workflow.ts typing)
- **Issue:** PaperData.storageId is `string` but createPaperRecords mutation expects `Id<"_storage">` (branded type)
- **Fix:** Added explicit cast `as Id<"_storage"> | undefined` at the mutation call site
- **Files modified:** convex/extraction/workflow.ts
- **Verification:** tsc --noEmit passes
- **Committed in:** 7e4d8dc (Task 1 commit)

**3. [Rule 1 - Bug] Fixed question type string widening**
- **Found during:** Task 1 (workflow.ts typing)
- **Issue:** Question type field was typed as `string` but enqueuePaperProcessing expects the union `"string" | "boolean" | "number" | "array"`
- **Fix:** Used the exact union type in the question parameter annotation
- **Files modified:** convex/extraction/workflow.ts
- **Verification:** tsc --noEmit passes
- **Committed in:** 7e4d8dc (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs - type narrowing issues)
**Impact on plan:** All auto-fixes necessary for TypeScript compilation. No scope creep. The plan anticipated these might occur ("If any inferred types from Convex queries/actions don't match, adjust the local types").

## Issues Encountered
- Pre-existing tsc error in workpoolActions.ts (audit module missing) confirmed unrelated to our changes -- line 721, same error present before plan execution

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 extraction production backend files are now fully typed with zero any annotations
- Ready for 61-02 (remaining extraction support/test files)
- Pre-existing tsc errors in other modules (audit, crons) remain but are out of scope

## Self-Check: PASSED

All 4 modified files exist. Both task commits (7e4d8dc, 1025ae4) verified in git log. SUMMARY.md created.

---
*Phase: 61-convex-production-backend*
*Completed: 2026-03-04*
