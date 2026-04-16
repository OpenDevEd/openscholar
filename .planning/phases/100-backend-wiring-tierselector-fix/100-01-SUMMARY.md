---
phase: 100-backend-wiring-tierselector-fix
plan: 01
subsystem: extraction
tags: [tier-selector, backend-wiring, cascade-filtering, extraction-pipeline]
dependency_graph:
  requires: []
  provides: [tier-field-schema, tier-aware-cascade, tier-workpool-threading]
  affects: [convex/schema.ts, convex/extraction/mutations.ts, convex/extraction/extract.ts, convex/extraction/workpoolActions.ts, convex/extraction/queries.ts]
tech_stack:
  added: []
  patterns: [switch-based-cascade-filtering, null-coalesce-backward-compat]
key_files:
  created: [convex/extraction/extract.test.ts (new test block)]
  modified: [convex/schema.ts, convex/extraction/mutations.ts, convex/extraction/extract.ts, convex/extraction/workpoolActions.ts, convex/extraction/queries.ts]
decisions:
  - ModelTier type declared locally in extract.ts (not imported from client component)
  - getJobInternal query extended with tier field for type-safe workpool access
metrics:
  duration: 211s
  completed: "2026-04-16T08:49:20Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
---

# Phase 100 Plan 01: Thread TierSelector Through Extraction Pipeline Summary

Tier selection wired end-to-end from mutation args through job row persistence to workpool action to cascade filtering function, with switch-based model selection (cheap=Flash Lite, accurate=Haiku, auto=full cascade).

## Changes Made

### Task 1: Add tier field to schema and mutation, thread through workpool and cascade

**Commit:** e5bcd5f

1. **convex/schema.ts** -- Added `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))` to `extractionJobs` table definition
2. **convex/extraction/mutations.ts** -- Added `tier` arg to `createExtractionJob` args validator; persisted as `tier: args.tier ?? "auto"` on job insert
3. **convex/extraction/extract.ts** -- Added `ModelTier` type; refactored `createCascadeTiers()` to accept optional tier parameter with switch-based filtering (cheap=index 0, accurate=last, auto/undefined=all); threaded tier through `extractSingleAnswer` and `extractAnswers` signatures
4. **convex/extraction/workpoolActions.ts** -- Reads `job.tier ?? "auto"` after loading job; passes tier as 7th argument to `extractAnswers`
5. **convex/extraction/queries.ts** -- Added `tier` to `getJobInternal` return validator and return object for type-safe access in workpool action

### Task 2: Add TIER-03 unit tests for cascade filtering

**Commit:** a77374c

Added `describe("tier-based cascade filtering (TIER-03)")` block with 3 tests:
- **cheap tier**: Verifies only `google/gemini-2.5-flash-lite` is used (cheapest model)
- **accurate tier**: Verifies only `anthropic/claude-haiku-4.5` is used (most capable model)
- **auto tier**: Forces cascade escalation through all 3 tiers, verifies all model names present

All 20 extraction tests pass with zero regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended getJobInternal query return type**
- **Found during:** Task 1 (TypeScript verification)
- **Issue:** `getJobInternal` query did not include `tier` in its return validator, causing TS2339 error when workpool action accessed `job.tier`
- **Fix:** Added `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))` to the query's return validator and `tier: job.tier` to the return object
- **Files modified:** convex/extraction/queries.ts
- **Commit:** e5bcd5f (included in Task 1 commit)

**2. [Rule 3 - Blocking] Removed unnecessary type cast in workpoolActions.ts**
- **Found during:** Task 1 (after fixing queries.ts)
- **Issue:** Initial implementation used `(job.tier as "auto" | "cheap" | "accurate" | undefined)` cast, but after extending the query type, the cast was unnecessary
- **Fix:** Simplified to `job.tier ?? "auto"` -- type-safe without cast
- **Files modified:** convex/extraction/workpoolActions.ts
- **Commit:** e5bcd5f

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Local ModelTier type in extract.ts | Cannot import from tier-selector.tsx ("use client" file); duplicating 1-line type is cleaner than shared types file for 3 literals |
| Extend getJobInternal query | Workpool action reads tier via typed query; adding to existing query avoids new function and maintains single DB read per paper |

## Known Stubs

None -- all wiring is complete and functional.

## Self-Check: PASSED

All 7 files verified present. Both commits (e5bcd5f, a77374c) verified in git log.
