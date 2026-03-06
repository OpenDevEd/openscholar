# Phase 73: Library Count Optimization - Research

**Researched:** 2026-03-06
**Domain:** Convex denormalized counter pattern
**Confidence:** HIGH

## Summary

The `getLibraryCount` query currently fetches up to 10,000 documents via `.take(10_000)` and returns `.length`. This is wasteful for a simple count and breaks for users with >10,000 items. The fix is a denormalized counter field on a per-user record, atomically maintained in all mutation paths.

There are exactly **3 mutation paths** that modify library items: `saveToLibrary` (insert or re-rate), `removeFromLibrary` (by item ID), and `removeFromLibraryByOpenalexId` (by OpenAlex ID). No bulk remove exists. The `saveToLibrary` mutation is an upsert -- it only inserts a new document when the paper is not already in the user's library (re-rating an existing paper should NOT increment the counter).

**Primary recommendation:** Add a `libraryItemCount` field to the `users` table (not a separate table), increment/decrement it atomically in the 3 mutation handlers, and lazy-backfill on first `getLibraryCount` access when the field is undefined.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PERF-01 | Library count query uses denormalized counter (not `.take(10_000).length`) | Add `libraryItemCount` field to `users` table; `getLibraryCount` reads it directly |
| PERF-02 | Counter atomically incremented/decremented in all save/delete mutations | 3 mutation paths identified: `saveToLibrary`, `removeFromLibrary`, `removeFromLibraryByOpenalexId` |
| PERF-03 | Lazy backfill computes count on first access for existing users | When `libraryItemCount` is `undefined`, count via index scan, persist, then return |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | (existing) | Backend database + functions | Already in use; counter is a simple field + patch |
| convex-test | (existing) | Unit testing Convex functions | Already used in `queries.test.ts` |
| vitest | (existing) | Test runner | Already configured with edge-runtime for convex tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Field on `users` table | `@convex-dev/sharded-counter` | Overkill -- REQUIREMENTS.md explicitly rules this out |
| Field on `users` table | `@convex-dev/aggregate` | Overkill -- REQUIREMENTS.md explicitly rules this out |
| Field on `users` table | Separate `libraryCounters` table | Unnecessary indirection; user record already exists per user |

## Architecture Patterns

### Pattern 1: Denormalized Counter on Users Table

**What:** Add an optional `libraryItemCount: v.optional(v.number())` field to the `users` table schema. The field is optional so existing user documents don't need a migration -- they'll be backfilled lazily.

**When to use:** Low write contention, single-writer per counter (only the owning user mutates their library).

**Schema change:**
```typescript
// In schema.ts, add to users table definition:
users: defineTable({
  // ... existing fields ...
  libraryItemCount: v.optional(v.number()),
})
```

### Pattern 2: Lazy Backfill on First Read

**What:** When `getLibraryCount` reads the user document and finds `libraryItemCount === undefined`, it performs a one-time count via the existing `by_user` index, persists the result via a mutation, and returns the count. Subsequent reads are O(1).

**Implementation approach:** Since queries in Convex are read-only and cannot write, the lazy backfill needs a mutation. Two options:
1. **Query returns undefined + client calls backfill mutation** -- adds client round-trip but is architecturally clean.
2. **Convert getLibraryCount to a mutation that reads and optionally writes** -- breaks reactivity (mutations don't re-run on data changes).

**Recommended approach:** Keep `getLibraryCount` as a query. If the counter is undefined, perform the count scan inline (still return the correct number). Schedule a separate internal mutation to persist the count. This way:
- The first call is slow (scan) but returns the correct value immediately
- A scheduled mutation persists the backfill
- All subsequent calls are O(1)

```typescript
// In getLibraryCount query:
if (user.libraryItemCount !== undefined) {
  return user.libraryItemCount;
}
// Backfill: count via index (one-time cost)
const items = await ctx.db
  .query("libraryItems")
  .withIndex("by_user", (q) => q.eq("userId", user._id))
  .collect();
const count = items.length;
// Schedule mutation to persist (query can't write)
await ctx.scheduler.runAfter(0, internal.library.mutations.backfillLibraryCount, {
  userId: user._id,
  count,
});
return count;
```

**Important:** The backfill mutation must be idempotent -- if the counter was already set by a concurrent save/remove, don't overwrite it. Use a compare-and-set pattern: only write if still undefined.

### Pattern 3: Atomic Counter Maintenance in Mutations

**What:** Each mutation that adds or removes a library item also patches the user's `libraryItemCount`.

**Key details for each mutation:**

1. **`saveToLibrary`** -- This is an upsert. Only increment when inserting a NEW item (not when re-rating an existing one).
```typescript
if (!existing) {
  // New save -- increment counter
  const currentCount = user.libraryItemCount ?? 0;
  await ctx.db.patch(user._id, { libraryItemCount: currentCount + 1 });
}
// If existing, just re-rate -- no counter change
```

2. **`removeFromLibrary`** -- Decrement after successful delete.
```typescript
const currentCount = user.libraryItemCount ?? 0;
await ctx.db.patch(user._id, { libraryItemCount: Math.max(0, currentCount - 1) });
```

3. **`removeFromLibraryByOpenalexId`** -- Only decrement if the item actually existed.
```typescript
if (item) {
  // ... delete item and memberships ...
  const currentCount = user.libraryItemCount ?? 0;
  await ctx.db.patch(user._id, { libraryItemCount: Math.max(0, currentCount - 1) });
}
```

### Anti-Patterns to Avoid
- **Incrementing on upsert without checking existence:** `saveToLibrary` is an upsert. Incrementing on every call (including re-rates) will inflate the counter.
- **Decrementing below zero:** Use `Math.max(0, count - 1)` to guard against edge cases.
- **Separate counter table:** Unnecessary indirection when the `users` table already exists with one record per user.
- **Backfill migration script:** A migration is not needed. Lazy backfill handles existing users transparently.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Counter consistency | Complex distributed counter | Simple field + atomic patch in same mutation | Single-writer (user owns their library), Convex mutations are transactional |
| Backfill migration | Batch migration script | Lazy backfill on first read | Zero downtime, no migration step, handles users who never return |

## Common Pitfalls

### Pitfall 1: Forgetting the Upsert Check in saveToLibrary
**What goes wrong:** Counter increments on every `saveToLibrary` call, including re-rates of existing items.
**Why it happens:** `saveToLibrary` is an upsert -- it checks for existing items and only inserts if new.
**How to avoid:** Only increment when `!existing` (the insert branch), never on the update branch.
**Warning signs:** Counter is higher than actual item count.

### Pitfall 2: Race Condition in Lazy Backfill
**What goes wrong:** Two concurrent requests both see `undefined`, both schedule backfill, second one overwrites a counter that was already incremented.
**Why it happens:** The backfill mutation runs asynchronously after the query.
**How to avoid:** Backfill mutation must check `if (user.libraryItemCount === undefined)` before writing. If it's already set, skip.
**Warning signs:** Counter resets to a stale value after a save that happened during backfill.

### Pitfall 3: Not Handling the removeFromLibraryByOpenalexId Path
**What goes wrong:** Counter becomes stale because one of the remove paths doesn't decrement.
**Why it happens:** There are two separate remove mutations (`removeFromLibrary` by ID, `removeFromLibraryByOpenalexId` by OpenAlex ID).
**How to avoid:** Audit all 3 mutation paths and add counter logic to each.

### Pitfall 4: Queries Cannot Write in Convex
**What goes wrong:** Attempting to persist the backfill count inside `getLibraryCount` query fails.
**Why it happens:** Convex queries are read-only by design.
**How to avoid:** Use `ctx.scheduler.runAfter(0, ...)` to schedule an internal mutation from the query.

## Code Examples

### Schema Change
```typescript
// convex/schema.ts - users table
users: defineTable({
  // ... existing fields ...
  libraryItemCount: v.optional(v.number()),
})
  // ... existing indexes (unchanged) ...
```

### Backfill Internal Mutation
```typescript
// convex/library/mutations.ts - new internal mutation
import { internalMutation } from "../_generated/server";

export const backfillLibraryCount = internalMutation({
  args: {
    userId: v.id("users"),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.libraryItemCount !== undefined) return;
    await ctx.db.patch(args.userId, { libraryItemCount: args.count });
  },
});
```

### Updated getLibraryCount
```typescript
export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    if (user.libraryItemCount !== undefined) {
      return user.libraryItemCount;
    }
    // Lazy backfill: count via index scan (one-time)
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const count = items.length;
    await ctx.scheduler.runAfter(0, internal.library.mutations.backfillLibraryCount, {
      userId: user._id,
      count,
    });
    return count;
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.take(10_000).length` | Denormalized counter field | This phase | O(1) reads, correct for any library size |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (edge-runtime for convex tests) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/library/queries.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERF-01 | `getLibraryCount` returns counter value (not scan) | unit | `npx vitest run convex/library/queries.test.ts -t "getLibraryCount"` | Exists (needs update) |
| PERF-02 | Save increments, remove decrements counter | unit | `npx vitest run convex/library/queries.test.ts -t "counter"` | Needs new tests |
| PERF-03 | First access with no counter triggers backfill | unit | `npx vitest run convex/library/queries.test.ts -t "backfill"` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/library/queries.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases for counter increment/decrement across all 3 mutation paths
- [ ] New test case for lazy backfill (user has items but no counter field)
- [ ] New test case for upsert not double-counting (re-rate should not increment)
- [ ] New test case for counter not going below zero on remove with undefined counter
- [ ] Update existing `getLibraryCount` tests to work with new counter-based approach

## Open Questions

1. **ctx.scheduler availability in queries**
   - What we know: Convex queries are read-only, but `ctx.scheduler.runAfter` may be available to schedule mutations from queries.
   - What's unclear: Whether `ctx.scheduler` is exposed in the query context. If not, the backfill must be triggered differently (e.g., client-side call or the query just does the scan each time until a mutation happens to set it).
   - Recommendation: Verify during implementation. If `ctx.scheduler` is not available in queries, alternative is to have the query return the scanned count and rely on the next `saveToLibrary` or `removeFromLibrary` call to initialize the counter. Or add a dedicated `initLibraryCount` mutation called from the client when the query returns a sentinel value.

## Sources

### Primary (HIGH confidence)
- `convex/library/mutations.ts` -- All 3 mutation paths identified and analyzed
- `convex/library/queries.ts` -- Current `getLibraryCount` implementation (lines 330-341)
- `convex/schema.ts` -- `libraryItems` and `users` table schemas
- `.planning/REQUIREMENTS.md` -- PERF-01, PERF-02, PERF-03 requirements; explicit out-of-scope for sharded-counter and aggregate
- `components/library/library-page-client.tsx` -- Client usage of `getLibraryCount`
- `components/rating-selector.tsx` -- Uses `saveToLibrary` and `removeFromLibraryByOpenalexId`
- `components/ui/focus-mode.tsx` -- Uses `saveToLibrary` and `removeFromLibraryByOpenalexId`

### Secondary (MEDIUM confidence)
- Convex documentation on query vs mutation capabilities (scheduling from queries)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, all existing
- Architecture: HIGH - straightforward denormalized counter pattern, well-understood
- Pitfalls: HIGH - all mutation paths identified from codebase analysis

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable pattern, no external dependencies)
