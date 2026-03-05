---
phase: 67-compiler-verification
plan: 02
subsystem: typing
tags: [typescript, strict-types, any-elimination, tsc, test-types, verification-script]

# Dependency graph
requires:
  - phase: 67-compiler-verification
    provides: Zero any types in production code (67-01)
  - phase: 66-test-files
    provides: Type-safe test files with factories and mock patterns
provides:
  - Zero any type annotations in ALL user-authored code (production + test)
  - Zero tsc errors outside Phase 68/69 scope
  - Reproducible verification script at scripts/verify-no-any.sh
affects: [68-http-routing, 69-audit]

# Tech tracking
tech-stack:
  added: []
  patterns: [MigratedSearchHistoryState typed cast for unknown migrate results, vi.mocked() for db.patch mock access, abstract new (...args never) for Stripe error constructor generics, as unknown as for RegisteredMutation handler access]

key-files:
  created:
    - scripts/verify-no-any.sh
  modified:
    - convex/library/queries.test.ts
    - convex/library/collections.test.ts
    - convex/extraction/cascade-delete.test.ts
    - tests/store-migrations.test.ts
    - tests/search-params-construction.test.ts
    - tests/export-download.test.ts
    - tests/export-exceljs-roundtrip.test.ts
    - tests/export-citations.test.ts
    - tests/ensure-user.test.ts
    - tests/sync-profile.test.ts
    - tests/ai-batch.test.ts
    - tests/subscription-details-error-mapping.test.ts
    - tests/live-billing/required.test.ts

key-decisions:
  - "Id<T> from _generated/dataModel instead of convex/values -- convex/values does not export Id"
  - "Doc<T> cast for ctx.db.get() return in convex-test -- returns union of all document types without narrowing"
  - "MigratedSearchHistoryState interface with typed migrate() helper -- cleanly casts unknown return from migrateSearchHistoryState"
  - "vi.mocked(ctx.db.patch) for mock access -- preserves MutationCtx type while accessing .mock.calls"
  - "abstract new (...args: never[]) => T for Stripe error constructor -- avoids any while accepting varying constructor signatures"
  - "as unknown as for RegisteredMutation to handler -- Convex RegisteredMutation does not expose .handler directly"

patterns-established:
  - "vi.mocked() wrapper: Use for accessing .mock on typed Convex context methods instead of as any casts"
  - "abstract new (...args: never[]) => T: Use for generic constructor parameters that accept classes with varying signatures"
  - "Doc<TableName> cast: Use on ctx.db.get() returns in convex-test when the generic ID produces a document union type"

requirements-completed: [STRICT-01]

# Metrics
duration: 10min
completed: 2026-03-04
---

# Phase 67 Plan 02: Test Any-Type Elimination and Verification Script Summary

**Zero any annotations in all test files with proper types: Id<T> imports, Doc<T> casts, MigratedSearchHistoryState interface, vi.mocked() wrappers, and a reproducible verification script confirming the zero-any state**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-04T22:39:28Z
- **Completed:** 2026-03-04T22:49:53Z
- **Tasks:** 2
- **Files modified:** 13 + 1 created

## Accomplishments
- Eliminated all `any` type annotations from 13 test files across convex/ and tests/ directories
- Fixed 80+ tsc errors in test files (store-migrations, search-params, export-download, export-exceljs, ensure-user, etc.)
- Created executable `scripts/verify-no-any.sh` that confirms zero any patterns and zero non-Phase-68/69 tsc errors
- All 780 tests pass after type changes
- Total remaining tsc errors: exactly 22 (all in Phase 68/69 scope: http.ts, audit, crons, envValidation)

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix any types and tsc errors in Convex and high-error-count test files** - `871550d` (feat)
2. **Task 2: Fix remaining test file errors and create verification script** - `1ba8c73` (feat)

## Files Created/Modified
- `convex/library/queries.test.ts` - Replaced any with Id<"users">, typed callback parameters
- `convex/library/collections.test.ts` - Replaced any with Id<T>, removed as any, used Doc<T> for db.get
- `convex/extraction/cascade-delete.test.ts` - Replaced any with Id<"_storage"> | undefined
- `tests/store-migrations.test.ts` - Added MigratedSearchHistoryState interface, typed migrate() helper
- `tests/search-params-construction.test.ts` - Added non-null assertions for result.filter, typed authorships
- `tests/export-download.test.ts` - Cast mock items as PaperResult via unknown
- `tests/export-exceljs-roundtrip.test.ts` - Fixed ExcelJS module import cast, removed unnecessary Buffer cast
- `tests/export-citations.test.ts` - Cast deliberately invalid test inputs through unknown
- `tests/ensure-user.test.ts` - Used as unknown as for handler access, vi.mocked() for db.patch
- `tests/sync-profile.test.ts` - Used as unknown as for RegisteredMutation handler access
- `tests/ai-batch.test.ts` - Cast batch config through unknown for Record<string, unknown>
- `tests/subscription-details-error-mapping.test.ts` - Used abstract new (...args: never[]) for Stripe constructors
- `tests/live-billing/required.test.ts` - Added non-null assertions for mySubscription
- `scripts/verify-no-any.sh` - Reproducible verification script: grep + tsc check with false positive filtering

## Decisions Made
- Imported `Id<T>` from `../_generated/dataModel` instead of `convex/values` -- the latter does not export `Id` in this Convex version
- Used `Doc<"collections"> | null` cast for `ctx.db.get()` returns in convex-test -- the generic returns a union of all 24+ document types without narrowing
- Created `MigratedSearchHistoryState` interface with a `migrate()` helper function -- cleanly wraps the `unknown` return from `migrateSearchHistoryState` without repeating casts
- Used `vi.mocked(ctx.db.patch)` to access `.mock.calls` -- preserves `MutationCtx` typing while exposing vitest mock interface
- Used `abstract new (...args: never[]) => T` for `makeStripeError` -- Stripe error constructors have incompatible signatures that don't match `new (...args: unknown[]) => T`
- Used `as unknown as` bridge for `RegisteredMutation` to handler object -- Convex `RegisteredMutation` type doesn't expose `.handler` directly (it's an internal detail exposed only through the mock)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed Id import path for convex-test files**
- **Found during:** Task 1 verification
- **Issue:** Plan suggested `import { Id } from "convex/values"` but `convex/values` does not export `Id` in this project's Convex version
- **Fix:** Changed to `import type { Id } from "../_generated/dataModel"` following existing codebase patterns
- **Files modified:** convex/library/queries.test.ts, convex/library/collections.test.ts, convex/extraction/cascade-delete.test.ts
- **Committed in:** 871550d (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Doc union type exposure from removing as any casts**
- **Found during:** Task 1 verification
- **Issue:** Removing `as any` from `ctx.db.get()` results in collections.test.ts exposed that convex-test returns a union of all document types, causing TS2339 (property does not exist on union)
- **Fix:** Added explicit `Doc<"collections"> | null` and `Doc<"libraryItems"> | null` casts at the db.get call sites
- **Files modified:** convex/library/collections.test.ts
- **Committed in:** 871550d (Task 1 commit)

**3. [Rule 1 - Bug] ExcelJS Buffer cast was unnecessary**
- **Found during:** Task 1 verification
- **Issue:** The `as Buffer` cast from the plan caused TS2345/TS2352 errors. Removing all casts and passing `buffer` directly resolved the issue (the types are actually compatible when not explicitly cast)
- **Fix:** Removed the `as Buffer` cast entirely -- `writeBuffer()` return is directly assignable to `load()` parameter
- **Files modified:** tests/export-exceljs-roundtrip.test.ts
- **Committed in:** 871550d (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All user-authored code (production + test) has zero any type annotations
- Zero tsc errors outside Phase 68 (http.ts) and Phase 69 (audit/crons/envValidation) scope
- Exactly 22 remaining tsc errors, all in Phase 68/69 scope
- Verification script at scripts/verify-no-any.sh confirms the clean state
- Ready for Phase 68 (http.ts routing) and Phase 69 (audit/crons) to eliminate the final 22 errors

## Self-Check: PASSED

All 14 modified/created files exist. Both task commits (871550d, 1ba8c73) verified in git log.

---
*Phase: 67-compiler-verification*
*Completed: 2026-03-04*
