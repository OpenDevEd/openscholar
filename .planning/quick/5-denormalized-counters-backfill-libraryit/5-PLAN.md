---
phase: quick-5
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - convex/library/mutations.ts
  - convex/library/collections.ts
  - convex/schema.ts
autonomous: true
requirements: [BACKFILL-LIBRARY-COUNT, COLLECTION-ITEM-COUNT]
must_haves:
  truths:
    - "All users with library items have libraryItemCount set (no more lazy-scan fallback)"
    - "Collections display itemCount from denormalized field, not N+1 queries"
    - "Adding/removing items from collections atomically updates collection itemCount"
    - "Removing a library item decrements itemCount on all its collections"
  artifacts:
    - path: "convex/library/mutations.ts"
      provides: "backfillAllLibraryCounts internal mutation"
      contains: "backfillAllLibraryCounts"
    - path: "convex/library/collections.ts"
      provides: "Denormalized itemCount read + atomic inc/dec"
      contains: "itemCount"
    - path: "convex/schema.ts"
      provides: "itemCount field on collections table"
      contains: "itemCount"
  key_links:
    - from: "convex/library/collections.ts:addToCollection"
      to: "collections table"
      via: "ctx.db.patch increment itemCount"
      pattern: "itemCount.*\\+.*1"
    - from: "convex/library/collections.ts:removeFromCollection"
      to: "collections table"
      via: "ctx.db.patch decrement itemCount"
      pattern: "itemCount.*-.*1"
    - from: "convex/library/mutations.ts:removeFromLibrary"
      to: "collections table"
      via: "decrement itemCount for each collection membership being deleted"
      pattern: "collection\\.itemCount"
---

<objective>
Backfill libraryItemCount for all users and add denormalized itemCount to collections, eliminating N+1 queries in getCollectionsWithCounts.

Purpose: The libraryItemCount backfill currently only runs per-user on mutation; users who haven't saved/removed since the counter was added still hit the scan fallback. Collections currently do N+1 queries to count memberships. Both need denormalized counters.

Output: A one-time backfill mutation for libraryItemCount, a denormalized itemCount on collections with atomic inc/dec, and a backfill for existing collection counts.
</objective>

<execution_context>
@/Users/mcharrad/.claude/get-shit-done/workflows/execute-plan.md
@/Users/mcharrad/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@convex/schema.ts
@convex/library/mutations.ts
@convex/library/collections.ts
@convex/library/queries.ts
@convex/lib/queryBounds.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Backfill libraryItemCount and add collection itemCount schema + mutations</name>
  <files>convex/schema.ts, convex/library/mutations.ts, convex/library/collections.ts</files>
  <action>
1. **Schema** (`convex/schema.ts`): Add `itemCount: v.optional(v.number())` to the `collections` table definition (after `updatedAt`).

2. **Backfill libraryItemCount** (`convex/library/mutations.ts`): Add a new `backfillAllLibraryCounts` internalMutation (no args). It should:
   - Query all users (paginated with `.take(100)` in a loop or use a cursor-based approach -- but since this is Convex, use a simple approach: query users table with `.collect()` since user count is small).
   - For each user where `libraryItemCount === undefined`:
     - Count their library items: `ctx.db.query("libraryItems").withIndex("by_user", q => q.eq("userId", user._id)).collect()` then `.length`.
     - Patch the user with `{ libraryItemCount: count }`.
   - Import `MAX_LIBRARY_BROWSE` from `../lib/queryBounds` and use `.take(MAX_LIBRARY_BROWSE)` for the items query (consistent with existing code).
   - Log how many users were backfilled.

3. **Backfill collection itemCount** (`convex/library/collections.ts`): Add a new `backfillCollectionCounts` internalMutation (no args). It should:
   - Query all collections with `.collect()` (bounded, ~50 per user max, total is small).
   - For each collection where `itemCount === undefined`:
     - Count memberships: `ctx.db.query("libraryItemCollections").withIndex("by_collection", q => q.eq("collectionId", collection._id)).collect()` then `.length`.
     - Patch collection with `{ itemCount: count }`.

4. **Update addToCollection** (`convex/library/collections.ts`): After the `ctx.db.insert("libraryItemCollections", ...)` call (line ~128), add:
   ```typescript
   const currentCount = collection.itemCount ?? 0;
   await ctx.db.patch(args.collectionId, { itemCount: currentCount + 1 });
   ```
   Note: `collection` is already fetched above for ownership check, so reuse it.

5. **Update removeFromCollection** (`convex/library/collections.ts`): Inside the `if (existing)` block after `ctx.db.delete(existing._id)` (line ~164), add:
   ```typescript
   const currentCount = collection.itemCount ?? 0;
   await ctx.db.patch(args.collectionId, { itemCount: Math.max(0, currentCount - 1) });
   ```
   Note: `collection` is already fetched above.

6. **Update removeFromLibrary and removeFromLibraryByOpenalexId** (`convex/library/mutations.ts`): In the cascade-delete loop where collection memberships are deleted, for each membership being deleted, load the collection and decrement its itemCount:
   ```typescript
   for (const m of memberships) {
     const col = await ctx.db.get(m.collectionId);
     if (col) {
       const currentCount = col.itemCount ?? 0;
       await ctx.db.patch(m.collectionId, { itemCount: Math.max(0, currentCount - 1) });
     }
     await ctx.db.delete(m._id);
   }
   ```
   Apply this pattern to BOTH `removeFromLibrary` (line ~122-128) and `removeFromLibraryByOpenalexId` (line ~88-94).

7. **Update deleteCollection** (`convex/library/collections.ts`): No change needed -- the collection is deleted entirely, so its itemCount is irrelevant.

8. **Update getCollectionsWithCounts** (`convex/library/collections.ts`): Replace the N+1 query pattern with a direct read of the denormalized counter. Change:
   ```typescript
   // OLD: fetches all memberships per collection
   const memberships = await ctx.db.query("libraryItemCollections")...
   return { ...collection, itemCount: memberships.length };
   ```
   To:
   ```typescript
   // NEW: read denormalized counter (fallback to 0 for unbackfilled)
   return { ...collection, itemCount: collection.itemCount ?? 0 };
   ```
   This makes it a simple map over collections with no additional queries.

9. **Add internalMutation import** if not already present in `collections.ts` -- add `internalMutation` to the import from `"../_generated/server"`.
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx convex deploy 2>&1 | tail -20</automated>
  </verify>
  <done>
    - Schema updated with itemCount on collections
    - backfillAllLibraryCounts and backfillCollectionCounts internal mutations exist and deploy successfully
    - addToCollection/removeFromCollection atomically inc/dec itemCount
    - removeFromLibrary/removeFromLibraryByOpenalexId decrement collection itemCount on cascade delete
    - getCollectionsWithCounts reads denormalized counter (O(1) per collection, no N+1)
  </done>
</task>

<task type="auto">
  <name>Task 2: Run backfill mutations in production</name>
  <files></files>
  <action>
After successful deploy, run both backfill mutations:

1. Run library count backfill:
   ```bash
   npx convex run library/mutations:backfillAllLibraryCounts
   ```

2. Run collection count backfill:
   ```bash
   npx convex run library/collections:backfillCollectionCounts
   ```

3. Verify by spot-checking a user's libraryItemCount matches their actual item count:
   ```bash
   npx convex run library/queries:getLibraryCount
   ```

Both mutations are idempotent (skip users/collections that already have counts set).
  </action>
  <verify>
    <automated>cd /Users/mcharrad/Documents/Github/openalex-count && npx convex run library/mutations:backfillAllLibraryCounts 2>&1 && npx convex run library/collections:backfillCollectionCounts 2>&1</automated>
  </verify>
  <done>
    - All users with library items have libraryItemCount set (no undefined values remaining)
    - All collections have itemCount set
    - getCollectionsWithCounts returns correct counts without N+1 queries
  </done>
</task>

</tasks>

<verification>
- `npx convex deploy` succeeds with no type errors
- Both backfill mutations run without errors
- getCollectionsWithCounts no longer queries libraryItemCollections table per collection
- getLibraryCount returns counter directly (no scan fallback for backfilled users)
</verification>

<success_criteria>
- libraryItemCount is set for every user who has library items
- collections.itemCount field exists in schema and is maintained atomically
- getCollectionsWithCounts reads denormalized counter (no N+1)
- addToCollection/removeFromCollection maintain itemCount
- removeFromLibrary cascade correctly decrements collection itemCounts
</success_criteria>

<output>
After completion, create `.planning/quick/5-denormalized-counters-backfill-libraryit/5-SUMMARY.md`
</output>
