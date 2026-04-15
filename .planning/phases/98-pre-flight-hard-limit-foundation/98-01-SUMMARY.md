---
phase: 98-pre-flight-hard-limit-foundation
plan: 01
status: completed
subsystem: extraction-limits
tags: [constants, subscription, reactive-query, foundation]
dependency_graph:
  requires: []
  provides: [EXTRACTION_LIMITS_BY_TIER, MAX_EXTRACTION_RESULTS_QUERY, getExtractionLimitForUser, getExtractionLimit]
  affects: [convex/lib/queryBounds.ts, convex/extraction/queries.ts]
tech_stack:
  added: []
  patterns: [per-tier-constant-map, subscription-aware-limit-resolver, reactive-limit-query]
key_files:
  created:
    - convex/lib/extractionLimit.ts
  modified:
    - convex/lib/queryBounds.ts
    - convex/extraction/queries.ts
decisions:
  - "Used import type for SubscriptionPlan to prevent Convex runtime bundling issues (Pitfall 3)"
  - "All four tiers set to 1000 for v7.0 uniformity; v7.1 edits only EXTRACTION_LIMITS_BY_TIER"
  - "getExtractionLimit returns plan as string (not SubscriptionPlan) to avoid cross-boundary type leak in reactive query validator"
metrics:
  duration_seconds: 129
  completed: "2026-04-15T16:05:14Z"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 98 Plan 01: Per-Tier Limit Constants, Helper, and Reactive Query Summary

Per-tier-ready extraction limit map with subscription-aware resolver helper and reactive query for client consumption.

## What Was Built

- **EXTRACTION_LIMITS_BY_TIER** in `convex/lib/queryBounds.ts`: A `Record<SubscriptionPlan, number>` mapping all four plans (free/go/pro/enterprise) to 1,000. Single source of truth for v7.1 per-tier differentiation.
- **MAX_EXTRACTION_PAPERS_PER_JOB** derived via `Math.max(...Object.values(EXTRACTION_LIMITS_BY_TIER))` instead of hardcoded 200. All 15 existing import sites work unchanged.
- **MAX_EXTRACTION_RESULTS_QUERY = 10,000** as a separate constant for internal `.take()` bounds, decoupled from the user-facing paper limit.
- **getExtractionLimitForUser** in `convex/lib/extractionLimit.ts`: Async helper that resolves a user's extraction limit by walking the subscription chain (fetch subscriptions -> selectCanonicalSubscription -> resolveEffectivePlan -> tier map lookup).
- **getExtractionLimit** reactive query in `convex/extraction/queries.ts`: Returns `{ limit, plan }` for authenticated users; `{ limit: 0, plan: "free" }` for unauthenticated. Phase 102 will consume this for the counter display.

## Key Decisions

1. Used `import type` for `SubscriptionPlan` to prevent Convex runtime bundling the entitlements module (Pitfall 3 from research).
2. All four tiers set to 1,000 for v7.0 uniformity -- v7.1 per-tier differentiation requires editing only `EXTRACTION_LIMITS_BY_TIER`.
3. `getExtractionLimit` query re-derives plan string via the subscription chain rather than adding a separate round-trip, since the subscription lookup is cheap (cardinality ~1-5 rows) and already reactive.
4. No existing queries, constants, or imports were modified -- only additive changes.

## Artifacts

| File | Action | Description |
|------|--------|-------------|
| `convex/lib/queryBounds.ts` | modified | Added `EXTRACTION_LIMITS_BY_TIER`, derived `MAX_EXTRACTION_PAPERS_PER_JOB`, added `MAX_EXTRACTION_RESULTS_QUERY` |
| `convex/lib/extractionLimit.ts` | created | `getExtractionLimitForUser(ctx, userId)` subscription-aware limit resolver |
| `convex/extraction/queries.ts` | modified | Added `getExtractionLimit` reactive query with auth guard |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `c85b5da` | Restructure queryBounds.ts with per-tier limit map |
| 2 | `63ae4ec` | Add extraction limit helper and reactive query |

## Verification

- TypeScript compilation: PASS (zero errors across all 3 files)
- EXTRACTION_LIMITS_BY_TIER exports correct shape with all 4 plans: PASS
- MAX_EXTRACTION_PAPERS_PER_JOB derived via Math.max: PASS
- MAX_EXTRACTION_RESULTS_QUERY = 10,000: PASS
- getExtractionLimitForUser uses full subscription resolution chain (.collect(), not .first()): PASS
- getExtractionLimit query returns { limit: number, plan: string } with auth guard: PASS
- All existing constants and queries unchanged: PASS

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all exports are fully wired with real subscription resolution logic.

## Threat Surface Scan

No new threat flags. The `getExtractionLimit` query derives identity server-side via `getCurrentUser(ctx)` (T-98-01 mitigated). Unauthenticated users receive only the generic `{ limit: 0, plan: "free" }` response (T-98-02 mitigated).
