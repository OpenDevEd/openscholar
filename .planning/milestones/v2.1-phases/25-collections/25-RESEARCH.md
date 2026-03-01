# Phase 25: Collections - Research

**Researched:** 2026-03-01
**Domain:** Convex junction tables, many-to-many relationships, collection CRUD, library filtering
**Confidence:** HIGH

## Summary

Phase 25 adds named collections to the library feature, enabling users to organize their saved papers with full CRUD (create, rename, delete) and many-to-many assignment (a library item can belong to multiple collections; a collection can contain many items). The architecture centers on two new Convex tables: `collections` for the named collections themselves and `libraryItemCollections` as the junction table mapping items to collections.

The existing codebase provides every building block needed. The `convex/library/` module already has `mutations.ts` and `queries.ts` with the `requireAuth` pattern, `convex-helpers/server/filter` for post-index filtering, and the `useProtectedPaginatedQuery`/`useProtectedQuery` hooks for auth-gated data fetching. The library page (`components/library/library-page-client.tsx`) already uses `nuqs` URL state, the `FilterSection` shared component, and the `DropdownMenu` pattern on item rows/cards. All six locale message files follow the flat JSON structure under `libraryPage.*` keys. No new npm packages are needed.

The key architectural decision is the collection filter strategy for the dual-path query (browse mode vs search mode). In browse mode, the query can filter by collection using the junction table lookup before pagination. In search mode (text search via `searchIndex`), Convex search indexes do not support filtering by a related table, so collection filtering must happen client-side or via a two-step approach: first fetch collection member IDs, then post-filter search results. The `convex-helpers` `filter()` function already handles this pattern (pages may be undersized, matching the existing rating filter approach documented in decision [23-01]).

**Primary recommendation:** Add `collections` and `libraryItemCollections` tables to schema.ts, create a `convex/library/collections.ts` file for collection CRUD mutations/queries, extend `browseLibrary` and `searchLibrary` with an optional `collectionId` filter parameter, add a `col` URL param to `librarySearchParams`, and build a collection management UI using the existing Dialog and DropdownMenu components.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COL-01 | User can create a new collection with a name | `createCollection` mutation: validate name non-empty, insert into `collections` table with `userId`, `name`, `createdAt`, `updatedAt`. Uses `requireAuth` pattern from existing library mutations |
| COL-02 | User can rename an existing collection | `renameCollection` mutation: fetch by ID, verify ownership, patch `name` and `updatedAt`. Same auth + ownership check pattern as `removeFromLibrary` |
| COL-03 | User can delete a collection (cascade deletes junction rows, does not delete library items) | `deleteCollection` mutation: delete all `libraryItemCollections` rows for the collection using `by_collection` index, then delete the collection doc. Follows the cascading delete pattern from `deleteExtractionInternal` |
| COL-04 | User can assign a library item to one or more collections | `addToCollection` mutation: insert junction row with `collectionId` + `libraryItemId` + `userId` + `assignedAt`. Check for existing assignment via compound index to prevent duplicates |
| COL-05 | User can remove an item from a collection without deleting it from the library | `removeFromCollection` mutation: find and delete the specific junction row by `by_collection_item` compound index. Library item remains untouched |
| COL-06 | Collections use a junction table (`libraryItemCollections`) for many-to-many, not array fields | Schema section defines `libraryItemCollections` table with foreign keys to both `collections` and `libraryItems`, plus compound indexes for both lookup directions |
| COL-07 | Each collection displays an item count badge | `getCollectionCounts` query: for each user collection, count junction rows using `by_collection` index + `.collect().length`. Acceptable for collections up to 1024 items (same pattern as `getLibraryCount`) |
| FILT-03 | User can filter library items by collection | Both `browseLibrary` and `searchLibrary` accept optional `collectionId` arg. When set, pre-fetch junction row `libraryItemId` set, then filter paginated results against that set. URL state via `col` param in nuqs |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | ^1.31.7 | Schema tables, indexes, mutations, queries for collections + junction table | Already the project's entire backend. `defineTable`, `v.id()` foreign keys, compound indexes are established patterns |
| `convex-helpers` | ^0.1.111 | `filter()` function for post-index filtering of collection membership | Already used in `browseLibrary` and `searchLibrary` for rating/date filters |
| `nuqs` | ^2.6.0 | URL state for collection filter parameter | Already manages all library filter/sort/view state via `librarySearchParams` |
| `next-intl` | ^4.8.2 | i18n for collection UI strings across 6 locales | Already used for all library page strings |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sonner` | ^2.0.7 | Toast feedback for collection operations (create, rename, delete) | Already in project for error toasts. Phase 26 will add comprehensive toast feedback, but basic error toasts should be wired now |
| `lucide-react` | ^0.487.0 | Icons for collection UI (FolderPlus, Folder, Pencil, Trash2, etc.) | Already used across all library components |
| `motion` | ^12.23.12 | Animations for collection UI elements | Already used in FilterSection, LibraryItemRow expand animation |
| `radix-ui` (Dialog, DropdownMenu) | ^1.4.3 | Dialog for create/rename collection, DropdownMenu for collection actions | Already in project, used by library item row/card actions |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Junction table (`libraryItemCollections`) | Array field on `libraryItems` (e.g., `collectionIds: v.array(v.id("collections"))`) | Array fields require updating every item when a collection is renamed/deleted. Junction table enables independent collection operations. COL-06 explicitly requires junction table |
| Counting junction rows per collection at query time | Denormalized `itemCount` field on `collections` table | Denormalized counts require careful increment/decrement on every add/remove and collection delete. For libraries under 1024 items, counting at query time (collect+length) is simpler and consistent with `getLibraryCount` pattern |
| Pre-fetching collection member IDs then filtering | Convex search index with collection filter field | Convex search indexes support a fixed set of `filterFields` defined at schema time. Adding a collection filter to `search_library` would require the field to be on `libraryItems` directly (which contradicts COL-06's junction table requirement). Two-step filter is the pragmatic approach |

**Installation:**
```bash
# No new packages needed. Zero npm install commands.
```

## Architecture Patterns

### Recommended Project Structure
```
convex/
  library/
    mutations.ts          # Existing (add: cascade-delete junction rows on library item removal)
    queries.ts            # Existing (extend: optional collectionId filter on browse + search)
    collections.ts        # NEW: collection CRUD mutations + queries

components/
  library/
    library-page-client.tsx     # Extend: collection filter state, collection sidebar/dropdown
    library-filters.tsx         # Extend: add collection filter section
    library-item-row.tsx        # Extend: "Add to collection" in dropdown menu
    library-item-card.tsx       # Extend: "Add to collection" in dropdown menu
    collection-manager.tsx      # NEW: create/rename/delete collection dialog
    collection-picker.tsx       # NEW: multi-select popover for assigning item to collections
    collection-filter.tsx       # NEW: collection filter component for FilterSection

lib/
  library/
    search-params.ts      # Extend: add `col` param for collection filter URL state
```

### Pattern 1: Junction Table Schema Design
**What:** Two new tables with compound indexes enabling lookups from both directions
**When to use:** When implementing many-to-many relationships in Convex
**Example:**
```typescript
// In convex/schema.ts
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]),

libraryItemCollections: defineTable({
  userId: v.id("users"),           // Denormalized for auth + index efficiency
  collectionId: v.id("collections"),
  libraryItemId: v.id("libraryItems"),
  assignedAt: v.number(),
})
  .index("by_collection", ["collectionId"])
  .index("by_item", ["libraryItemId"])
  .index("by_collection_item", ["collectionId", "libraryItemId"])
  .index("by_user", ["userId"]),
```
**Confidence:** HIGH -- follows the exact pattern used by `extractionResults` (junction between papers and questions) and the existing compound index conventions.

### Pattern 2: Collection-Filtered Browse Query
**What:** Two-step query that first fetches collection member IDs, then post-filters the paginated browse results
**When to use:** When filtering paginated results by membership in a junction table
**Example:**
```typescript
// In convex/library/queries.ts - browseLibrary extended
export const browseLibrary = query({
  args: {
    // ... existing args ...
    collectionId: v.optional(v.id("collections")),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // If filtering by collection, pre-fetch the member item IDs
    let collectionItemIds: Set<string> | null = null;
    if (args.collectionId) {
      const memberships = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId!))
        .collect();
      collectionItemIds = new Set(memberships.map((m) => m.libraryItemId));
    }

    // ... existing index query setup ...

    // Add collection membership to the filter predicate
    const needsFilter = /* existing conditions */ || collectionItemIds !== null;

    if (needsFilter) {
      return await filter(q, (item) => {
        // existing filters...
        if (collectionItemIds && !collectionItemIds.has(item._id)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});
```
**Confidence:** HIGH -- this is the same `convex-helpers` `filter()` pattern already used for rating and date filters. Pages may be undersized when many items are filtered out (documented limitation, decision [23-01]).

### Pattern 3: Cascade Delete on Collection Deletion
**What:** Delete all junction rows for a collection before deleting the collection itself
**When to use:** When deleting a parent entity that has junction table references
**Example:**
```typescript
// In convex/library/collections.ts
export const deleteCollection = mutation({
  args: { collectionId: v.id("collections") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw createError("NOT_FOUND", "Collection not found");
    if (collection.userId !== user._id) throw createError("FORBIDDEN", "Not your collection");

    // Cascade: delete all junction rows
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .collect();
    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    // Delete the collection itself
    await ctx.db.delete(args.collectionId);
    return null;
  },
});
```
**Confidence:** HIGH -- follows the extraction job cascade delete pattern. For collections with fewer than ~100 items, this fits within a single Convex transaction. Batching (like `deleteExtractionInternal`) is unnecessary for typical collection sizes.

### Pattern 4: Duplicate Assignment Prevention
**What:** Check for existing junction row before inserting to prevent duplicate assignments
**When to use:** When assigning an item to a collection
**Example:**
```typescript
export const addToCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    libraryItemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    // Verify ownership of both entities
    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your collection");
    }
    const item = await ctx.db.get(args.libraryItemId);
    if (!item || item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    // Check for existing assignment (idempotent)
    const existing = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection_item", (q) =>
        q.eq("collectionId", args.collectionId).eq("libraryItemId", args.libraryItemId)
      )
      .unique();

    if (existing) return null; // Already assigned, noop

    await ctx.db.insert("libraryItemCollections", {
      userId: user._id,
      collectionId: args.collectionId,
      libraryItemId: args.libraryItemId,
      assignedAt: Date.now(),
    });
    return null;
  },
});
```
**Confidence:** HIGH -- compound index `by_collection_item` guarantees unique lookup. Same pattern as the `saveToLibrary` upsert checking `by_user_openalexId`.

### Pattern 5: Collection Picker Multi-Select (UI)
**What:** Popover with checkboxes showing all user collections, allowing toggle-on/toggle-off assignment
**When to use:** When user clicks "Add to collection" from the item row/card dropdown
**Example:**
```typescript
// Conceptual component structure
function CollectionPicker({ libraryItemId }: { libraryItemId: Id<"libraryItems"> }) {
  const { data: collections } = useProtectedQuery(
    api.library.collections.listCollections, {}
  );
  const { data: itemCollections } = useProtectedQuery(
    api.library.collections.getItemCollections, { libraryItemId }
  );

  const addToCollection = useMutation(api.library.collections.addToCollection);
  const removeFromCollection = useMutation(api.library.collections.removeFromCollection);

  // Render: Popover with checkboxes for each collection
  // Checked = item is in that collection
  // Toggle fires addToCollection or removeFromCollection
}
```
**Confidence:** HIGH -- uses existing `Popover` + `Checkbox` components from shadcn/ui already in the project.

### Pattern 6: Library Item Removal Cascade
**What:** When a library item is deleted, its junction rows must also be cleaned up
**When to use:** Extend existing `removeFromLibrary` and `removeFromLibraryByOpenalexId` mutations
**Example:**
```typescript
// In convex/library/mutations.ts - extend removeFromLibrary
export const removeFromLibrary = mutation({
  // ... existing args ...
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw createError("NOT_FOUND", "Library item not found");
    if (item.userId !== user._id) throw createError("FORBIDDEN", "Not your library item");

    // NEW: cascade-delete junction rows
    const memberships = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_item", (q) => q.eq("libraryItemId", args.itemId))
      .collect();
    for (const m of memberships) {
      await ctx.db.delete(m._id);
    }

    await ctx.db.delete(args.itemId);
    return null;
  },
});
```
**Confidence:** HIGH -- essential for referential integrity. Without this, orphaned junction rows accumulate.

### Anti-Patterns to Avoid

- **Array fields for collection membership:** Storing `collectionIds: v.array(v.id("collections"))` on `libraryItems` violates COL-06 and creates update contention (every add/remove rewrites the library item document). Junction tables are the correct relational pattern.

- **Denormalized item counts on collections:** Storing `itemCount` on the `collections` table seems efficient but creates a consistency burden. Every add/remove/delete must update the count atomically. For typical library sizes (under 1024 items per collection), counting junction rows at query time is simpler and avoids stale counts.

- **Filtering by collection in Convex search index:** The `search_library` search index has fixed `filterFields: ["userId", "rating"]`. Collection membership is a junction table relationship, not a field on `libraryItems`. Do NOT attempt to add `collectionId` to the search index -- use the two-step filter approach instead.

- **Separate API calls per collection for item count:** Querying each collection's count individually creates N+1 queries. Instead, use a single `getCollectionCounts` query that iterates all user collections and returns a map of `{ collectionId: count }`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Post-index filtering for collection membership | Manual pagination + filter loop | `convex-helpers/server/filter` | Already used for rating/date filters. Handles pagination edge cases correctly |
| URL state for collection filter | Manual `window.location` or `useSearchParams` | `nuqs` `parseAsString` for collection ID param | Already manages all library state. Adding `col` param follows established pattern |
| Multi-select popover UI | Custom checkbox list from scratch | shadcn `Popover` + `Checkbox` components | Already in the project (`@radix-ui/react-popover`, `@radix-ui/react-checkbox`). Re-use for consistency |
| Confirmation dialogs | Custom modal for delete confirmation | Existing `showConfirmation()` utility from `lib/confirmation.tsx` | Already used by library item removal. Pattern is battle-tested |
| Toast notifications | Custom notification system | `sonner` toast via `toast.success()` / `toast.error()` | Already wired in layout, used for error feedback |

**Key insight:** Every UI pattern needed for collections (dialogs, dropdowns, popovers, checkboxes, filter sections, toasts, confirmations) already exists in the project. The work is composing them, not building them.

## Common Pitfalls

### Pitfall 1: Orphaned Junction Rows on Library Item Deletion
**What goes wrong:** User deletes a library item but junction rows in `libraryItemCollections` remain, causing phantom items in collection counts and potential errors when filtering.
**Why it happens:** The existing `removeFromLibrary` and `removeFromLibraryByOpenalexId` mutations only delete the `libraryItems` document.
**How to avoid:** Extend both removal mutations to cascade-delete junction rows using the `by_item` index before deleting the library item itself.
**Warning signs:** Collection item counts are higher than actual visible items; filtering by collection shows unexpected empty slots.

### Pitfall 2: Collection Filter + Text Search Interaction
**What goes wrong:** When user has both a collection filter and a text search active simultaneously, the two filtering mechanisms can conflict or produce unexpected empty results.
**Why it happens:** Text search uses `searchIndex` which only filters by `userId` and `rating`. Collection filtering is a separate junction table lookup. Both must be applied.
**How to avoid:** In `searchLibrary`, when `collectionId` is provided, pre-fetch the collection member IDs set, then use `convex-helpers` `filter()` to intersect search results with collection membership. This is the same two-step approach used for rating filters.
**Warning signs:** Documented as an edge case concern in STATE.md blocker: "Collection filter + text search combination: edge case where user has both active needs explicit decision in Phase 25 planning."
**Resolution:** Use the same `filter()` approach that already handles rating + search. The filter predicate checks `collectionItemIds.has(item._id)` after the search index query. Pages may be undersized (existing documented behavior).

### Pitfall 3: Convex Transaction Limits on Large Collection Deletes
**What goes wrong:** Deleting a collection with many items (hundreds) could exceed Convex's transaction size limit (8MB or 8192 document writes per transaction).
**Why it happens:** Cascade-deleting hundreds of junction rows in a single mutation.
**How to avoid:** For MVP, collections under ~100 items fit comfortably in a single transaction. If needed later, adopt the batched cascade pattern from `deleteExtractionInternal` (process BATCH_SIZE items, reschedule self). Document this as a future optimization, not a blocker.
**Warning signs:** Mutation failures on large collection deletions.

### Pitfall 4: N+1 Query for Collection Item Counts
**What goes wrong:** Rendering a sidebar or filter with 10+ collections, each with its own `getItemCount` query, creates excessive reactive subscriptions.
**Why it happens:** Naive implementation queries each collection count independently.
**How to avoid:** Create a single `getCollectionsWithCounts` query that fetches all user collections and counts junction rows in one pass, returning an array of `{ _id, name, itemCount }`.
**Warning signs:** Visible latency rendering the collection list, many concurrent Convex subscriptions.

### Pitfall 5: Stale Collection Filter After Collection Deletion
**What goes wrong:** User deletes a collection while the `col` URL param still references it. The query tries to filter by a non-existent collection, returning empty results.
**Why it happens:** URL state is independent of server state.
**How to avoid:** In the `browseLibrary`/`searchLibrary` queries, if `collectionId` is provided but the collection doesn't exist (or isn't owned by the user), treat it as "no collection filter" (return unfiltered results). On the client side, clear the `col` param after collection deletion.
**Warning signs:** Empty library view after deleting the active filter collection.

## Code Examples

### Junction Table Schema (convex/schema.ts additions)
```typescript
// Add to defineSchema({}) in convex/schema.ts

// COLLECTIONS - Named groups for organizing library items
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"]),

// LIBRARY ITEM COLLECTIONS - Junction table for many-to-many
libraryItemCollections: defineTable({
  userId: v.id("users"),
  collectionId: v.id("collections"),
  libraryItemId: v.id("libraryItems"),
  assignedAt: v.number(),
})
  .index("by_collection", ["collectionId"])
  .index("by_item", ["libraryItemId"])
  .index("by_collection_item", ["collectionId", "libraryItemId"])
  .index("by_user", ["userId"]),
```

### URL State Extension (lib/library/search-params.ts)
```typescript
// Add to librarySearchParams:
col: parseAsString, // Collection ID filter (null = all collections)
```

### Collection Filter in FilterSection
```typescript
// New FilterSection for collection filter, following the existing pattern
<FilterSection
  title={t("filterCollection")}
  icon={FolderOpen}
  isActive={params.col !== null}
  onClear={params.col !== null ? () => setParams({ col: null }) : undefined}
>
  {/* Collection dropdown select */}
  <Select
    value={params.col ?? ""}
    onValueChange={(v) => setParams({ col: v || null })}
  >
    <SelectTrigger className="h-7 text-xs">
      <SelectValue placeholder={t("allCollections")} />
    </SelectTrigger>
    <SelectContent>
      {collections?.map((c) => (
        <SelectItem key={c._id} value={c._id} className="text-xs">
          {c.name}
          <Badge variant="secondary" className="ml-2 text-[10px]">
            {c.itemCount}
          </Badge>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</FilterSection>
```

### Collection Management Dialog
```typescript
// Basic create collection dialog pattern
<Dialog open={createOpen} onOpenChange={setCreateOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t("createCollection")}</DialogTitle>
      <DialogDescription>{t("createCollectionDescription")}</DialogDescription>
    </DialogHeader>
    <Input
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
      placeholder={t("collectionNamePlaceholder")}
      maxLength={100}
    />
    <DialogFooter>
      <Button variant="outline" onClick={() => setCreateOpen(false)}>
        {t("cancelButton")}
      </Button>
      <Button
        onClick={handleCreate}
        disabled={!newName.trim()}
      >
        {t("createButton")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### i18n Keys to Add (per locale)
```json
{
  "libraryPage": {
    "filterCollection": "Collection",
    "allCollections": "All collections",
    "createCollection": "Create collection",
    "createCollectionDescription": "Give your collection a name to organize your papers.",
    "collectionNamePlaceholder": "Collection name",
    "createButton": "Create",
    "renameCollection": "Rename collection",
    "deleteCollection": "Delete collection",
    "deleteCollectionConfirmTitle": "Delete collection",
    "deleteCollectionConfirmMessage": "Delete \"{name}\"? Papers in this collection will not be removed from your library.",
    "addToCollection": "Add to collection",
    "removeFromCollectionConfirmTitle": "Remove from collection",
    "removeFromCollectionConfirmMessage": "Remove this paper from \"{name}\"?",
    "manageCollections": "Manage collections",
    "noCollections": "No collections yet",
    "collectionItemCount": "{count, plural, =0 {No papers} one {1 paper} other {# papers}}"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Array fields for many-to-many | Junction tables with compound indexes | Convex best practice since v1.0 | Proper relational modeling, no document size bloat, efficient lookups in both directions |
| Denormalized counts | Count at query time for small datasets | Project convention (decision [23-01]) | Simpler code, no stale count bugs. Acceptable for libraries up to 1024 items |
| Client-side filtering | `convex-helpers/server/filter()` with pagination | convex-helpers ^0.1.x | Server-side filtering integrated with Convex pagination. Pages may be undersized but correctness is guaranteed |

**Deprecated/outdated:**
- None relevant. All patterns (Convex schema, convex-helpers filter, nuqs, radix-ui) are current.

## Open Questions

1. **Collection limit per user**
   - What we know: No requirement specifies a maximum number of collections per user.
   - What's unclear: Should there be a soft limit (e.g., 50 collections) to prevent UI clutter?
   - Recommendation: No limit for MVP. The UI (select dropdown) scales fine to ~50 collections. If needed, add a limit later.

2. **Collection ordering/sorting**
   - What we know: Requirements don't specify how collections should be ordered in the filter dropdown or management UI.
   - What's unclear: Alphabetical? Creation date? Custom order?
   - Recommendation: Alphabetical by name (simplest, most intuitive). Sort in the query using `.order("asc")` or sort client-side after fetch.

3. **Collection name uniqueness**
   - What we know: Requirements don't specify whether collection names must be unique per user.
   - What's unclear: Can a user have two collections with the same name?
   - Recommendation: Allow duplicates (simpler) but show a soft warning in the UI. Users can differentiate by renaming. No unique constraint needed in the schema.

4. **Grid view collection assignment**
   - What we know: The grid view card (`LibraryItemCard`) uses a `DropdownMenu` for actions, same as list view.
   - What's unclear: Should the collection picker appear in the dropdown or as a separate interaction?
   - Recommendation: Add "Add to collection" as a dropdown menu item in both list and grid views. Clicking it opens the collection picker popover/dialog.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `convex/schema.ts` -- existing table patterns, index conventions, `libraryItems` table structure
- Codebase analysis: `convex/library/queries.ts` -- `browseLibrary`, `searchLibrary` dual-path query pattern with `convex-helpers/server/filter`
- Codebase analysis: `convex/library/mutations.ts` -- `removeFromLibrary`, `saveToLibrary` auth + CRUD patterns
- Codebase analysis: `convex/extraction/mutations.ts` -- `deleteExtractionInternal` cascading delete pattern
- Codebase analysis: `components/library/library-page-client.tsx` -- URL state, dual-path query orchestration, filter UI composition
- Codebase analysis: `components/library/library-filters.tsx` -- `FilterSection` usage, select/button filter patterns
- Codebase analysis: `components/library/library-item-row.tsx` + `library-item-card.tsx` -- `DropdownMenu` action pattern
- Codebase analysis: `lib/library/search-params.ts` -- nuqs parser map, URL param naming conventions
- Codebase analysis: `lib/confirmation.tsx` -- `showConfirmation()` utility for destructive action dialogs
- Codebase analysis: `convex/library/queries.test.ts` -- test patterns with `convex-test`, seed helpers, auth identity setup
- Codebase analysis: `messages/en-US.json` -- i18n key structure under `libraryPage.*`

### Secondary (MEDIUM confidence)
- Convex documentation on compound indexes and junction tables (standard relational pattern, verified against codebase usage)
- `convex-helpers` filter function behavior with pagination (verified by existing usage in `queries.ts`)

### Tertiary (LOW confidence)
- None. All findings are verified against the existing codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- every library used is already in the project, no new dependencies
- Architecture: HIGH -- all patterns are direct extensions of existing library/extraction code
- Pitfalls: HIGH -- derived from codebase analysis and the STATE.md blocker note about collection+search interaction

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable domain, no external dependency changes expected)
