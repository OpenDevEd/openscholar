---
phase: 101-workbench-primitives
plan: 01
subsystem: ui
tags: [zustand, tanstack-react-table, column-definitions, persistence, localStorage]

requires:
  - phase: 100-backend-wiring-tierselector-fix
    provides: extraction pipeline and job creation backend
provides:
  - useExtractionResultsViewStore (column visibility + active view persistence)
  - createWorkbenchColumns factory (static + dynamic TanStack Table v8 columns)
  - WorkbenchPaper and ExtractionQuestion type exports
  - MemoizedConfidenceBadge and MemoizedStatusBadge module-level wrappers
affects: [101-02, 101-03, 103-workbench-views]

tech-stack:
  added: ["@tanstack/react-table@^8.21.3"]
  patterns: [module-level column hoisting, worst-confidence-wins aggregation, toggleColumn with missing-key-means-visible convention]

key-files:
  created:
    - lib/store/extraction-results-view.ts
    - lib/extraction/workbench-columns.tsx
    - tests/extraction-results-view-store.test.ts
    - tests/workbench-columns.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "createJSONStorage with localStorage (no custom adapter needed since all values are plain objects, unlike basket store's Map)"
  - "Column visibility convention: missing key = visible (default true), explicit false = hidden"
  - "Worst-confidence-wins aggregation for paper-level confidence badge (low > medium > high)"
  - "Static columns array defined once at module scope to prevent PITFALL 4 re-render storms"

patterns-established:
  - "Module-level column hoisting: static columns defined outside createWorkbenchColumns, dynamic columns appended per-call"
  - "toggleColumn convention: !(state.columnVisibility[columnId] ?? true) -- missing key defaults to visible"

requirements-completed: [WB-02, WB-03]

duration: 4min
completed: 2026-04-16
---

# Phase 101 Plan 01: Workbench Primitives Summary

**Zustand persist store for view state + TanStack Table v8 column factory with worst-confidence aggregation, module-level hoisting, and 17 unit tests**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-16T09:48:22Z
- **Completed:** 2026-04-16T09:52:53Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Zustand persist store (`useExtractionResultsViewStore`) with columnVisibility and activeView persisted to localStorage across browser sessions
- Column definitions factory (`createWorkbenchColumns`) generating 5 static columns (title, status, confidence, doi, parsingSource) plus dynamic question columns with correct filterFn assignments
- Module-level React.memo wrappers for ConfidenceBadge and StatusBadge preventing PITFALL 4 re-render storms at 1k rows
- 17 unit tests passing across both modules (8 store + 9 column factory)

## Task Commits

Each task was committed atomically (TDD red/green):

1. **Task 1: Zustand extraction-results-view store with tests**
   - `9e449c7` (test: RED -- failing store tests)
   - `1255c45` (feat: GREEN -- store implementation)

2. **Task 2: Workbench column definitions factory with tests**
   - `2bea706` (test: RED -- failing column tests)
   - `74d5873` (feat: GREEN -- column factory implementation + @tanstack/react-table dependency)

## TDD Gate Compliance

- RED gate: `test(101-01)` commits `9e449c7` and `2bea706` (both verified failing before implementation)
- GREEN gate: `feat(101-01)` commits `1255c45` and `74d5873` (all 17 tests passing)
- REFACTOR gate: not needed (code clean on first pass)

## Files Created/Modified
- `lib/store/extraction-results-view.ts` - Zustand persist store for column visibility and active view
- `lib/extraction/workbench-columns.tsx` - TanStack Table v8 column definitions factory
- `tests/extraction-results-view-store.test.ts` - 8 store tests (CRUD, persistence, migration)
- `tests/workbench-columns.test.ts` - 9 column factory tests (structure, filterFn, accessorFn)
- `package.json` - Added @tanstack/react-table@^8.21.3
- `pnpm-lock.yaml` - Updated lockfile

## Decisions Made
- Used `createJSONStorage(() => localStorage)` instead of custom storage adapter (all values are plain objects, unlike basket store's Map which needs custom serialization)
- Column visibility convention: missing key in `columnVisibility` record means visible (default true); explicit `false` means hidden -- matches TanStack Table's convention
- Worst-confidence-wins aggregation for paper-level confidence: if any result is "low", paper shows "low"; if any "medium", shows "medium"; only "high" if all results are "high"
- Static columns array hoisted outside `createWorkbenchColumns` at module scope -- prevents recreating column objects on every render call

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed @tanstack/react-table dependency**
- **Found during:** Task 2 (Column factory implementation)
- **Issue:** `@tanstack/react-table` not yet in package.json, needed for `ColumnDef` type import
- **Fix:** Ran `pnpm add @tanstack/react-table@^8.21.3` (planned milestone dependency per STATE.md decision)
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** Import succeeds, all 9 column tests pass, tsc clean
- **Committed in:** 74d5873 (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] Reinstalled node_modules in worktree**
- **Found during:** Task 2 (test execution)
- **Issue:** Worktree was missing vitest binary in node_modules/.bin (worktree-specific pnpm issue)
- **Fix:** Ran `pnpm install --frozen-lockfile` to restore binaries
- **Files modified:** none (node_modules only)
- **Verification:** `npx vitest --version` reports 3.2.4

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both were expected infrastructure needs. No scope creep.

## Issues Encountered
- Vitest `-x` flag does not exist in v3.2.4 (plan referenced it); used `--bail 1` instead
- Pre-existing TypeScript error in `tests/crash-prevention/prompt-delimiters.test.ts` (regex flag targeting issue) -- unrelated to this plan, not addressed

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Store and column factory are ready for Phase 101-02 (shared toolbar) and Phase 103 (4-view workbench)
- `useExtractionResultsViewStore` exports `columnVisibility` for the column picker component
- `createWorkbenchColumns` returns properly typed `ColumnDef<WorkbenchPaper>[]` for `useReactTable`
- No blockers identified

## Self-Check: PASSED

All 5 files verified on disk. All 4 commit hashes verified in git log.

---
*Phase: 101-workbench-primitives*
*Completed: 2026-04-16*
