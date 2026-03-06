---
phase: quick-5
plan: 01
subsystem: library
tags: [denormalization, backfill, performance, collections]
dependency_graph:
  requires: []
  provides: [denormalized-collection-itemcount, backfill-library-counts]
  affects: [library-mutations, library-collections, library-queries]
tech_stack:
  added: []
  patterns: [denormalized-counters, atomic-increment, backfill-mutation]
key_files:
  created: []
  modified:
    - convex/schema.ts
    - convex/library/mutations.ts
    - convex/library/collections.ts
decisions:
  - Used internalMutation for backfills (not public-facing, one-time use)
  - Fallback to 0 for unbackfilled collections in getCollectionsWithCounts
metrics:
  duration: 228s
  completed: "2026-03-06T09:21:13Z"
  tasks_completed: 2
  tasks_total: 2
---

# Quick Task 5: Denormalized Counters Backfill Summary

Denormalized itemCount on collections with atomic inc/dec, eliminating N+1 queries in getCollectionsWithCounts; backfilled libraryItemCount for all users and itemCount for all collections.

## What Was Done

### Task 1: Schema + Mutations + Counter Maintenance (b6f2446)

1. **Schema**: Added `itemCount: v.optional(v.number())` to the `collections` table.

2. **backfillAllLibraryCounts** (`mutations.ts`): New internalMutation that queries all users and sets `libraryItemCount` for any user where it was undefined. Uses `MAX_LIBRARY_BROWSE` bound for item counting.

3. **backfillCollectionCounts** (`collections.ts`): New internalMutation that queries all collections and sets `itemCount` for any collection where it was undefined by counting junction rows.

4. **addToCollection**: After inserting junction row, atomically increments `collection.itemCount`.

5. **removeFromCollection**: After deleting junction row, atomically decrements `collection.itemCount` (with `Math.max(0, ...)` guard).

6. **removeFromLibrary / removeFromLibraryByOpenalexId**: Cascade delete now loads each collection and decrements its `itemCount` before deleting the membership row.

7. **getCollectionsWithCounts**: Replaced N+1 `Promise.all` pattern (querying `libraryItemCollections` per collection) with simple `collection.itemCount ?? 0` read. O(1) per collection.

### Task 2: Run Backfills

- **Dev**: Backfilled 42 users and 4 collections successfully.
- **Prod**: Deployed and ran backfills (0 users/collections needed backfill on prod).
- **Idempotency verified**: Re-running backfills reports 0 changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CLERK_JWT_ISSUER_DOMAIN missing from prod environment**
- **Found during:** Task 2 (prod deploy)
- **Issue:** `npx convex deploy` failed because `CLERK_JWT_ISSUER_DOMAIN` env var was not set in prod
- **Fix:** Set the env var via `npx convex env set CLERK_JWT_ISSUER_DOMAIN` on prod
- **Files modified:** None (environment config only)

## Verification

- `npx convex dev --once` succeeded (no type errors)
- `npx convex deploy --yes` succeeded on prod
- Both backfill mutations ran without errors on dev and prod
- Backfills are idempotent (0 on re-run)
- getCollectionsWithCounts no longer queries libraryItemCollections per collection

## Self-Check: PASSED
