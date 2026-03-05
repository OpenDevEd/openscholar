---
phase: 63-client-libraries
plan: 03
subsystem: ai, library, filters
tags: [zod, vercel-ai-sdk, convex, openalex-sdk, type-safety]

# Dependency graph
requires:
  - phase: 63-01-client-libraries
    provides: Core lib typing patterns (store, auth, utils)
provides:
  - Type-safe AI schemas builder with z.ZodTypeAny
  - Type-safe AI operation execution without as any
  - Type-safe AI hook factory with Record<string, unknown> generic constraint
  - Verified type-safe filter builder (zero any annotations)
  - Type-safe paper data trimmer with WorkInput interface
affects: [64-hooks-components, 65-page-components]

# Tech tracking
tech-stack:
  added: []
  patterns: [WorkInput interface for OpenAlex Work subset, Parameters<typeof fn>[0] for complex SDK casts, as never for Convex useAction generic bridge]

key-files:
  created: []
  modified:
    - lib/ai/core/schemas.ts
    - lib/ai/core/execute.ts
    - lib/ai/client/hook-factory.ts
    - lib/library/trim-paper-data.ts
    - components/rating-selector.tsx

key-decisions:
  - "WorkInput interface instead of SDK Work type — SDK nested types (Authorship.Author) require id field that callers and tests omit"
  - "Parameters<typeof generateObject>[0] via unknown for execute.ts — generateObject generic constraints too complex for direct type narrowing"
  - "as never for Convex useAction bridge — same pattern as use-auth-query.ts for generic type mismatch"

patterns-established:
  - "WorkInput partial interface: Define minimal interfaces for SDK types when nested required fields conflict with actual usage"
  - "SDK function parameter cast: Use as unknown as Parameters<typeof fn>[0] when SDK generics are too complex for direct typing"

requirements-completed: [LIB-05]

# Metrics
duration: 14min
completed: 2026-03-04
---

# Phase 63 Plan 03: AI Libraries, Filter Builder, and Trim Paper Data Summary

**Zero any annotations across 5 files: AI schemas (z.ZodTypeAny), execute (Parameters cast), hook-factory (Record<string, unknown> + as never), filter-builder (verified clean), trim-paper-data (WorkInput interface)**

## Performance

- **Duration:** 14 min
- **Started:** 2026-03-04T12:56:23Z
- **Completed:** 2026-03-04T13:10:18Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Eliminated all any annotations in 4 AI/library files (schemas.ts, execute.ts, hook-factory.ts, trim-paper-data.ts)
- Verified filter-builder.ts already clean (zero any annotations)
- All 7 existing trim-paper-data tests pass unchanged
- Zero new TypeScript errors introduced

## Task Commits

Each task was committed atomically:

1. **Task 1: Type AI libraries + verify filter-builder** - `abe9380` (feat)
2. **Task 2: Type lib/library/trim-paper-data.ts** - `bac7b4a` (feat)

## Files Created/Modified
- `lib/ai/core/schemas.ts` - Record<string, z.ZodTypeAny> instead of Record<string, any>
- `lib/ai/core/execute.ts` - Parameters<typeof generateObject>[0] cast instead of as any
- `lib/ai/client/hook-factory.ts` - Record<string, unknown> generic constraint + as never cast
- `lib/library/trim-paper-data.ts` - WorkInput interface with typed authorships/location/open_access
- `components/rating-selector.tsx` - Updated paperResult prop from Record<string, any> to WorkInput

## Decisions Made
- Used `z.ZodTypeAny` for Zod schema property maps instead of generic `any` -- this is Zod's own base type
- Used `as unknown as Parameters<typeof generateObject>[0]` for execute.ts because Vercel AI SDK's generic constraints on generateObject are too complex for direct casting
- Used `as never` for convexAction params in hook-factory.ts -- matches the pattern already used in use-auth-query.ts
- Created `WorkInput` minimal interface instead of importing `Work` from SDK -- the SDK's nested `Authorship.Author` type requires `id: string` which callers and tests don't provide
- Exported `WorkInput` and updated rating-selector.tsx caller (Rule 3 -- blocking tsc error)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated rating-selector.tsx caller to use WorkInput**
- **Found during:** Task 2 (Type trim-paper-data)
- **Issue:** Changing trimPaperData parameter from Record<string, any> to WorkInput caused tsc error in rating-selector.tsx which passed paperResult?: Record<string, any>
- **Fix:** Exported WorkInput from trim-paper-data.ts, imported and used as paperResult prop type
- **Files modified:** components/rating-selector.tsx
- **Verification:** npx tsc --noEmit passes with zero errors in target files
- **Committed in:** bac7b4a (Task 2 commit)

**2. [Rule 3 - Blocking] Used WorkInput interface instead of SDK Work type**
- **Found during:** Task 2 (Type trim-paper-data)
- **Issue:** SDK Work type has Authorship.Author with required id: string, but tests and callers construct partial author objects without id
- **Fix:** Defined minimal WorkInput interface capturing only the fields trimPaperData accesses, with all nested types using optional properties
- **Files modified:** lib/library/trim-paper-data.ts
- **Verification:** All 7 existing tests pass, tsc passes
- **Committed in:** bac7b4a (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for compilation. WorkInput is a more precise type than either Record<string, any> or the full SDK Work type. No scope creep.

## Issues Encountered
- generateObject in execute.ts could not be directly cast via `as Parameters<typeof generateObject>[0]` -- TypeScript required double cast through `unknown` first due to insufficient type overlap. Used `as unknown as Parameters<typeof generateObject>[0]` which is still far more specific than `as any`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All AI library files, filter-builder, and trim-paper-data are fully typed
- Ready for phase 64 (hooks/components) or further type safety work
- Pre-existing tsc error in lib/library/export.ts (JsonObject type mismatch) is unrelated and out of scope

---
*Phase: 63-client-libraries*
*Completed: 2026-03-04*
