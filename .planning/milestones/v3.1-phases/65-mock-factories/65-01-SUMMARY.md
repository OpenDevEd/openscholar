---
phase: 65-mock-factories
plan: 01
subsystem: testing
tags: [vitest, mock-factories, convex, stripe, type-safety]

# Dependency graph
requires:
  - phase: 60-convex-validators-typed-records
    provides: "Convex schema types and generated server/dataModel types"
provides:
  - "Typed mock factories for Convex QueryCtx, MutationCtx, ActionCtx"
  - "Typed Id<TableName> factory replacing unsafe string casts"
  - "Typed document factories for users, subscriptions, extractionPapers, extractionResults"
  - "Typed Stripe event and invoice factories"
  - "Typed Convex function reference factories for webhook handler tests"
  - "Convex server module mock helper for vi.mock patterns"
affects: [66-replace-test-any-casts]

# Tech tracking
tech-stack:
  added: []
  patterns: ["mock factory with DeepPartial overrides", "as unknown as Type for branded type bridging", "Symbol-based function reference mocks"]

key-files:
  created:
    - tests/factories/convex-context.ts
    - tests/factories/convex-ids.ts
    - tests/factories/stripe-events.ts
    - tests/factories/index.ts

key-decisions:
  - "Used DeepPartial<T> with deep merge for context factory overrides -- enables selective nested mock customization"
  - "Used TableNames | SystemTableNames constraint on mockId generic -- satisfies Convex Id<T> type parameter requirement"
  - "Added createMockExtractionResult beyond plan spec -- commonly mocked in extraction tests alongside papers"
  - "Used index signature [key: string]: unknown on ExtractionPaperOverrides -- tests add extra fields like results array"

patterns-established:
  - "Factory pattern: sensible defaults + optional overrides via spread"
  - "Type bridging: as unknown as Type (never as any) for mock objects"
  - "Barrel export: all factories importable from tests/factories"

requirements-completed: [MOCK-01]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 65 Plan 01: Mock Factories Summary

**Typed mock factory infrastructure for Convex context, branded IDs, documents, Stripe events, and function references -- zero unsafe casts**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T21:16:55Z
- **Completed:** 2026-03-04T21:19:50Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- Created typed mock factories for all three Convex context types (QueryCtx, MutationCtx, ActionCtx) with DeepPartial override support
- Created `mockId<TableName>()` factory that produces properly branded `Id<T>` values, replacing `"id_1" as any` patterns
- Created document factories for users, subscriptions, extractionPapers, and extractionResults with sensible defaults
- Created Stripe event/invoice factories and Convex function reference factories for webhook handler tests
- Achieved zero `as any` casts across all 4 factory files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Convex context and Id/document mock factories** - `7f9cafe` (feat)
2. **Task 2: Create Stripe event factories and barrel index** - `7311a84` (feat)

## Files Created/Modified
- `tests/factories/convex-context.ts` - QueryCtx, MutationCtx, ActionCtx factories with DeepPartial overrides; Clerk identity factory; server module mock helper
- `tests/factories/convex-ids.ts` - mockId<TableName> factory; createMockUser, createMockSubscription, createMockExtractionPaper, createMockExtractionResult
- `tests/factories/stripe-events.ts` - Stripe event/invoice factories; Convex function reference factories (mutation refs, grant refs)
- `tests/factories/index.ts` - Barrel re-export of all factory modules

## Decisions Made
- Used `DeepPartial<T>` with a custom deep merge utility for context factory overrides, enabling selective nested mock customization without replacing entire branches
- Used `TableNames | SystemTableNames` constraint on `mockId` generic parameter to satisfy Convex `Id<T>` type requirements (plain `string` was too wide)
- Added `createMockExtractionResult` beyond plan spec since it is commonly mocked alongside extraction papers in test files
- Used `[key: string]: unknown` index signature on ExtractionPaperOverrides to allow tests to pass extra fields (e.g. `results` array) not in the schema

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mockId generic constraint**
- **Found during:** Task 1
- **Issue:** Using `<T extends string>` for `mockId` caused `Type 'string' is not assignable to type 'SystemTableNames | TableNames'` compilation error
- **Fix:** Changed constraint to `<T extends TableNames | SystemTableNames>` and imported `TableNames` from dataModel and `SystemTableNames` from convex/server
- **Files modified:** tests/factories/convex-ids.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 7f9cafe (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential for type correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All factories are importable via `from "../factories"` or `from "../../tests/factories"`
- Phase 66 can now replace all `as any` casts in test files with properly typed factory calls
- Factory return types match real Convex/Stripe types verified by tsc

## Self-Check: PASSED

All 4 factory files exist. Both task commits (7f9cafe, 7311a84) verified in git log.

---
*Phase: 65-mock-factories*
*Completed: 2026-03-04*
