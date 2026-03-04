---
phase: 63-client-libraries
plan: 01
subsystem: ui
tags: [typescript, type-safety, zustand, convex, openalex-sdk]

# Dependency graph
requires:
  - phase: 62-convex-debug-test-backend
    provides: "Type-safe Convex debug/test backend"
provides:
  - "Type-safe utility functions (JsonValue, OpenAlexSearchParams, SortByWork)"
  - "Type-safe Zustand stores with unknown-typed migrations"
  - "Type-safe Convex auth query hooks (never casts instead of any)"
affects: [63-02, 63-03, components, hooks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JsonValue recursive type for dynamic JSON structures"
    - "unknown + internal cast for Zustand persist migrate callbacks"
    - "as never pattern for Convex SDK generic type boundary casts"
    - "String() narrowing for Record<string, unknown> property access"

key-files:
  created: []
  modified:
    - "lib/utils.ts"
    - "lib/store.ts"
    - "lib/auth/use-auth-query.ts"

key-decisions:
  - "Recursive JsonValue type for dynamic JSON instead of any — covers all JSON-serializable shapes"
  - "OpenAlexSearchParams interface with SortByWork import for createSearchParameters typing"
  - "as never instead of as any at Convex useQuery/usePaginatedQuery boundary — satisfies generic constraints without widening"
  - "unknown with internal typed casts for Zustand persist migrate — correct since persisted shape varies by version"
  - "String() and typeof narrowing for Record<string, unknown> values in import functions"

patterns-established:
  - "JsonValue pattern: use type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue } for dynamic data"
  - "Zustand migrate pattern: (persistedState: unknown) => { const state = persistedState as TypedShape; ... }"
  - "Convex hook pattern: useQuery(query as never, args as never) to bridge generic type gap"

requirements-completed: [LIB-01, LIB-02, LIB-03]

# Metrics
duration: 6min
completed: 2026-03-04
---

# Phase 63 Plan 01: Client Libraries Core Typing Summary

**Recursive JsonValue type, OpenAlexSearchParams interface, unknown-typed Zustand migrations, and as-never Convex hook casts — zero any in 3 foundational lib files**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-04T12:56:22Z
- **Completed:** 2026-03-04T13:02:33Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Eliminated all ~10 any annotations in lib/utils.ts with JsonValue, OpenAlexSearchParams, and SortByWork types
- Eliminated all ~6 any annotations in lib/store.ts with unknown-typed migrate callbacks and typed internal casts
- Replaced all 6 as-any casts in lib/auth/use-auth-query.ts with as-never pattern at Convex SDK boundary

## Task Commits

Each task was committed atomically:

1. **Task 1: Type lib/utils.ts** - `ffc748b` (feat)
2. **Task 2: Type lib/store.ts and lib/auth/use-auth-query.ts** - `d021a1d` (feat)

## Files Created/Modified
- `lib/utils.ts` - Added JsonValue type, OpenAlexSearchParams interface, SortByWork import; replaced all any with specific types
- `lib/store.ts` - Changed migrate callbacks to unknown with internal typed casts; typed import function parameters
- `lib/auth/use-auth-query.ts` - Replaced as any with as never at Convex useQuery/usePaginatedQuery boundaries

## Decisions Made
- **JsonValue recursive type** over simple `unknown` for JsonObject values — preserves structural compatibility with JSON.stringify and jsonToCSV while eliminating any
- **OpenAlexSearchParams interface** defined inline in createSearchParameters — scoped to the function that uses it, avoids polluting module exports
- **as never at Convex boundary** over FunctionReference cast — cleaner, well-known TypeScript pattern for generic constraint satisfaction without type widening
- **String() narrowing** in import functions — explicit conversion from unknown to string for Record<string, unknown> values is safer than type assertion
- **as JsonObject cast** in downloadWithMetadata CSV branch — data is always objects when format is csv, safe narrowing from JsonValue

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript errors from Record<string, unknown> property access**
- **Found during:** Task 2 (lib/store.ts typing)
- **Issue:** Changing importSearchHistory/importKeywords params from any[] to Record<string, unknown>[] made property access return unknown, causing TS2322 errors
- **Fix:** Added String() wrapping and typeof narrowing for extracted values
- **Files modified:** lib/store.ts
- **Verification:** npx tsc --noEmit passes with 0 errors in target files
- **Committed in:** d021a1d (Task 2 commit)

**2. [Rule 1 - Bug] Fixed JsonValue not assignable to JsonObject parameter**
- **Found during:** Task 1 (lib/utils.ts typing)
- **Issue:** downloadWithMetadata passes data (typed as JsonValue) to jsonToCSV which expects JsonObject | JsonObject[]
- **Fix:** Added cast `data as JsonObject | JsonObject[]` in CSV branch — data is always object-shaped when format is csv
- **Files modified:** lib/utils.ts
- **Verification:** npx tsc --noEmit passes with 0 errors in utils.ts
- **Committed in:** ffc748b (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary to maintain type safety after eliminating any. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three foundational lib files are fully typed
- Ready for 63-02 (component-level typing) which imports from these files
- Patterns established (JsonValue, unknown migrations, as never) can be reused in remaining plans

## Self-Check: PASSED

- FOUND: lib/utils.ts
- FOUND: lib/store.ts
- FOUND: lib/auth/use-auth-query.ts
- FOUND: ffc748b (Task 1 commit)
- FOUND: d021a1d (Task 2 commit)
- any annotations remaining: 0
- tsc errors in target files: 0

---
*Phase: 63-client-libraries*
*Completed: 2026-03-04*
