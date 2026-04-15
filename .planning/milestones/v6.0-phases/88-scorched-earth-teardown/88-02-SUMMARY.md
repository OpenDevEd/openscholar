---
phase: 88-scorched-earth-teardown
plan: 02
subsystem: teardown
tags: [deletion, extraction, cleanup, surgical-edit, shared-files]

# Dependency graph
requires: [88-01]
provides:
  - "All 9 shared frontend files have zero extraction references"
  - "Zustand store extraction slice fully removed (state, actions, persist, citation panel)"
  - "AI client/core modules extraction-free (types, schemas, prompts, configs, executor, router)"
  - "Sidebar navigation extraction entry removed"
  - "Type re-exports extraction block removed"
affects: [88-03, 88-04]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - lib/store.ts
    - lib/types/index.ts
    - lib/types/search.types.ts
    - components/app-sidebar.tsx
    - lib/ai/core/types.ts
    - lib/ai/core/schemas.ts
    - lib/ai/core/prompts.ts
    - lib/ai/core/configs.ts
    - lib/ai/client/executor.ts
    - lib/ai/client/router.ts
    - lib/ai/core/batch-types.ts
    - lib/ai/core/batch.ts

key-decisions:
  - "Removed unused useFeatureFlag and useSubscriptionState imports from app-sidebar.tsx after extraction references removed (no other consumers)"
  - "Removed DataExtractionQuestion re-export from types/index.ts (unused alias, screening.types.ts definition preserved per D-05)"
  - "Removed stale extraction comments from batch-types.ts and batch.ts (dead code cleanup)"
  - "Removed useGenerateExtractionQuestions hook and GenerateExtractionQuestionsParams type alias from router.ts (dangling import fix)"

patterns-established: []

requirements-completed: [TEAR-10]

# Metrics
duration: 8min
completed: 2026-04-15
---

# Phase 88 Plan 02: Shared Frontend File Surgery Summary

**Surgically removed all extraction references from 12 shared frontend files across Zustand store, type system, sidebar navigation, and AI client/core modules**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-14T23:07:05Z
- **Completed:** 2026-04-14T23:15:15Z
- **Tasks:** 2 (+ 1 deviation fix)
- **Files modified:** 12

## Accomplishments
- Removed extraction state fields, actions, defaults, and persist whitelist entries from Zustand store (lib/store.ts)
- Removed useExtractionCitationPanelStore and getExtractionCitationPanelDimensions from store
- Removed ExtractionSortBy type from search.types.ts
- Removed 18-type extraction re-export block and ExtractionSortBy from types/index.ts
- Removed extraction nav entry, Database icon, feature flag check, and subscription plan check from app-sidebar.tsx
- Removed GenerateExtractionQuestionsInput/Output interfaces from AI core types
- Removed extractionQuestionsSchema from AI core schemas
- Removed buildExtractionQuestionsPrompts function from AI core prompts
- Removed getExtractionQuestionsConfig function from AI core configs
- Removed generateExtractionQuestions executor from AI client executor
- Removed useGenerateExtractionQuestions hook from AI client router
- All non-extraction functionality preserved: screening (46 refs in store, 8 in sidebar), translation (3 refs in configs), search, history, bookmarks

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove extraction from Zustand store, type files, and sidebar** - `7a76b72` (feat) -- 4 files modified, 101 lines removed
2. **Task 2: Remove extraction from AI client/core modules** - `f9457ae` (feat) -- 8 files modified, 133 lines removed
3. **Deviation fix: Remove unused DataExtractionQuestion re-export** - `64d3d93` (fix) -- 1 file modified, 1 line removed

## Files Created/Modified
- `lib/store.ts` -- Extraction slice removed (state, actions, defaults, persist, citation panel store)
- `lib/types/index.ts` -- Extraction re-exports and unused DataExtractionQuestion alias removed
- `lib/types/search.types.ts` -- ExtractionSortBy type definition removed
- `components/app-sidebar.tsx` -- Extraction nav entry, Database icon, feature flag, subscription check, and related imports removed
- `lib/ai/core/types.ts` -- GenerateExtractionQuestionsInput/Output interfaces and generateExtractionQuestions operation type removed
- `lib/ai/core/schemas.ts` -- extractionQuestionsSchema removed
- `lib/ai/core/prompts.ts` -- buildExtractionQuestionsPrompts function and GenerateExtractionQuestionsInput import removed
- `lib/ai/core/configs.ts` -- getExtractionQuestionsConfig function and extraction imports removed
- `lib/ai/client/executor.ts` -- generateExtractionQuestions executor and extraction imports removed
- `lib/ai/client/router.ts` -- useGenerateExtractionQuestions hook and GenerateExtractionQuestionsParams type removed
- `lib/ai/core/batch-types.ts` -- Stale extraction comment removed
- `lib/ai/core/batch.ts` -- Stale extraction comment removed

## Decisions Made
- Removed `useFeatureFlag` import from sidebar: `extraction.enabled` was the only feature flag check in the file
- Removed `useSubscriptionState` import and usage from sidebar: only used for `hasExtractionPlan` check which was extraction-specific
- Removed `DataExtractionQuestion` re-export from types/index.ts: unused alias (zero consumers), screening.types.ts definition preserved per D-05
- Cleaned up router.ts extraction references: dangling imports would cause compilation failure (Rule 3 blocking fix)
- Removed stale extraction comments from batch files: dead code per CLAUDE.md Rule 3

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed extraction references from lib/ai/client/router.ts**
- **Found during:** Task 2 verification
- **Issue:** router.ts imported GenerateExtractionQuestionsInput from types.ts and referenced generateExtractionQuestions from executor.ts -- both removed in Task 2, causing broken imports
- **Fix:** Removed GenerateExtractionQuestionsInput import, GenerateExtractionQuestionsParams type alias, and useGenerateExtractionQuestions hook from router.ts
- **Files modified:** lib/ai/client/router.ts
- **Committed in:** f9457ae (Task 2 commit)

**2. [Rule 2 - Missing Critical] Removed stale extraction comments from batch files**
- **Found during:** Task 2 verification
- **Issue:** batch-types.ts and batch.ts contained stale "Extraction batch types/processor removed" comments
- **Fix:** Removed dead comments per CLAUDE.md no-legacy-code directive
- **Files modified:** lib/ai/core/batch-types.ts, lib/ai/core/batch.ts
- **Committed in:** f9457ae (Task 2 commit)

**3. [Rule 1 - Bug] Removed unused DataExtractionQuestion re-export from types/index.ts**
- **Found during:** Overall verification
- **Issue:** DataExtractionQuestion (screening alias) in index.ts caused `grep -c extraction` to return 1 instead of 0
- **Fix:** Removed unused re-export (zero consumers in codebase). Source definition in screening.types.ts preserved per D-05
- **Files modified:** lib/types/index.ts
- **Committed in:** 64d3d93

**4. [Rule 1 - Bug] Removed unused useFeatureFlag and useSubscriptionState from sidebar**
- **Found during:** Task 1 execution
- **Issue:** After removing extraction feature flag check and plan check, both imports became unused
- **Fix:** Removed both imports and the `subscriptionState` const declaration
- **Files modified:** components/app-sidebar.tsx
- **Committed in:** 7a76b72 (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking, 1 missing critical, 2 bugs)
**Impact on plan:** All auto-fixes necessary for clean compilation and acceptance criteria. No scope creep -- stayed within extraction teardown boundary.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None -- this plan is purely surgical editing of existing files with no new code.

## Self-Check: PASSED

All claims verified:
- SUMMARY.md exists on disk
- Task 1 commit `7a76b72` found in git log
- Task 2 commit `f9457ae` found in git log
- Deviation fix commit `64d3d93` found in git log
- All 10 modified files confirmed present
- Zero extraction references across all 9 target files confirmed

## Next Phase Readiness
- All 9+ shared frontend files now have zero extraction references
- Codebase will still NOT compile (expected) -- convex backend files still reference extraction modules
- Plan 03 handles convex function deletion and shared convex file surgery
- Plan 04 handles schema, config, package cleanup, i18n, and test cleanup

---
*Phase: 88-scorched-earth-teardown*
*Completed: 2026-04-15*
