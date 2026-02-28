# Architecture Research

**Domain:** Library & Collections integration into existing Next.js + Convex academic search app
**Researched:** 2026-02-28
**Confidence:** HIGH

## System Overview

```
Current State (v2.0)                         New (v2.1)
========================                     ========================

Browser                                      Browser
  |                                            |
  |-- Zustand (ratings, search history,        |-- Zustand (UI prefs only for library)
  |    bookmarks -- all localStorage)          |
  |                                            |-- Convex React hooks
  |-- OpenAlex API (via server action)         |    (useProtectedQuery, useProtectedPaginatedQuery)
  |                                            |
  v                                            v
Next.js Server Action                        Convex Backend
  |                                            |
  |-- getSearchResults()                       |-- libraryItems table (full JSON)
  |                                            |-- collections table
  v                                            |-- collectionItems table (junction)
Convex Backend                                 |
  |                                            |-- library/ domain module
  |-- users, credits, subscriptions,           |    queries.ts, mutations.ts
  |    extraction jobs, etc.                   |
  |                                            v
  v                                          Search Index + DB Indexes
Database (existing tables)                   (text search on title/authors)
```

### What Changes

The key architectural shift for v2.1: **ratings move from client-only Zustand state to server-persisted Convex documents**. Today, `useRatingsStore` in `lib/store.ts` stores ratings as `Record<string, number>` in localStorage. Rating an item will now trigger a Convex mutation that persists the full OpenAlex Work JSON alongside the rating.

### What Stays the Same

- Search flow (OpenAlex API via server action) -- unchanged
- Existing Convex domain modules (users, credits, subscriptions, extraction) -- untouched
- Auth pattern (`requireAuth` from `convex/lib/auth.ts`) -- reused
- Protected query wrappers (`useProtectedQuery`, `useProtectedPaginatedQuery`) -- reused
- Command Center UI pattern -- reused for /library page

## Component Responsibilities

| Component | Responsibility | New / Modified |
|-----------|----------------|----------------|
| `convex/library/mutations.ts` | Save/remove library items, update ratings | NEW |
| `convex/library/queries.ts` | List library items with filters, get item by ID | NEW |
| `convex/collections/mutations.ts` | CRUD collections, assign/remove items | NEW |
| `convex/collections/queries.ts` | List user collections, get collection details | NEW |
| `convex/schema.ts` | Add 3 new tables + indexes + search index | MODIFIED |
| `convex/lib/validators.ts` | Add library/collection validators | MODIFIED |
| `components/rating-selector.tsx` | Trigger Convex mutation on rating change | MODIFIED |
| `app/library/page.tsx` | New /library route | NEW |
| `components/library-command-center/` | Library page UI shell | NEW |
| `lib/store.ts` (useRatingsStore) | Bridge: read from Convex, write triggers mutation | MODIFIED |

## New Convex Tables

### Table 1: `libraryItems`

Stores the full academic item JSON when a user rates it. One row per user-item pair.

```typescript
libraryItems: defineTable({
  userId: v.id("users"),
  openalexId: v.string(),          // OpenAlex Work ID (e.g., "W2741809807")
  rating: v.number(),              // 0-5 star rating
  title: v.string(),               // Denormalized for search index + display
  authors: v.optional(v.string()), // Comma-joined author names for search
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  itemData: v.any(),               // Full OpenAlex Work JSON (~5-20KB typically)
  savedAt: v.number(),             // When first saved
  updatedAt: v.number(),           // When rating last changed
})
  .index("by_user", ["userId"])
  .index("by_user_openalex", ["userId", "openalexId"])
  .index("by_user_rating", ["userId", "rating"])
  .index("by_user_saved", ["userId", "savedAt"])
  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["userId"],
  })
```

**Why `v.any()` for `itemData`:**
- The OpenAlex Work type has ~40 optional fields, deeply nested objects (authorships, locations, concepts), and evolves independently of our schema. Defining it exhaustively with Convex validators would be brittle and high-maintenance.
- A typical Work JSON is 5-20KB, well under the 1MB Convex document limit.
- The fields we need to filter/search on (`title`, `authors`, `publicationYear`, `rating`) are extracted as top-level typed fields. `itemData` is the opaque blob for rendering.
- This is the same pattern used in `extractionJobs.searchFilters` (which uses `v.record(v.string(), v.any())`).

**Why denormalize `title` and `authors`:**
- Convex search indexes only work on top-level string fields defined in the schema. You cannot search inside `v.any()`.
- Denormalizing `title` as a proper `v.string()` field enables the `search_title` search index for text search.
- `authors` as a comma-joined string enables search to find papers by author name.

### Table 2: `collections`

User-created groupings for organizing library items.

```typescript
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),    // Optional UI color tag
  itemCount: v.number(),            // Denormalized count for display
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_name", ["userId", "name"])
```

**Why denormalize `itemCount`:**
- Counting items by querying the junction table on every list render is expensive (N+1 queries or collect + count).
- Increment/decrement `itemCount` atomically in the mutation that adds/removes items.
- This is standard practice in Convex apps for computed aggregates.

### Table 3: `collectionItems` (junction table)

Many-to-many relationship between library items and collections.

```typescript
collectionItems: defineTable({
  collectionId: v.id("collections"),
  libraryItemId: v.id("libraryItems"),
  addedAt: v.number(),
})
  .index("by_collection", ["collectionId"])
  .index("by_library_item", ["libraryItemId"])
  .index("by_collection_item", ["collectionId", "libraryItemId"])
```

**Why a junction table (not an array field):**
- Convex arrays are capped at 8,192 entries. While unlikely to hit for collections, it would be a hard ceiling.
- Junction tables allow efficient bidirectional queries: "which collections contain item X?" and "which items are in collection Y?"
- Standard Convex pattern documented at stack.convex.dev. The project already has `convex-helpers` (v0.1.111) which provides `getManyVia` for this pattern.
- Adding metadata to the relationship (e.g., `addedAt`, future `notes`) is trivial.

## Data Flow

### Rating a Paper (Save to Library)

```
User clicks star rating on search results page
    |
    v
RatingSelector component
    |-- (1) Call Convex mutation: library.mutations.saveOrUpdateItem
    |       Args: { openalexId, rating, itemData (full Work JSON) }
    |
    v
Convex mutation (library/mutations.ts)
    |-- (2) requireAuth(ctx) --> get userId
    |-- (3) Check existing: db.query("libraryItems")
    |       .withIndex("by_user_openalex", q => q.eq("userId", userId).eq("openalexId", openalexId))
    |       .unique()
    |-- (4a) EXISTS: db.patch(existing._id, { rating, updatedAt: Date.now() })
    |-- (4b) NEW: db.insert("libraryItems", {
    |         userId, openalexId, rating,
    |         title: itemData.display_name ?? itemData.title ?? "",
    |         authors: (itemData.authorships ?? []).map(a => a.author.display_name).join(", "),
    |         publicationYear: itemData.publication_year,
    |         doi: itemData.doi,
    |         itemData,
    |         savedAt: Date.now(), updatedAt: Date.now()
    |       })
    |
    v
Convex reactive query invalidation
    |-- Library page auto-updates if open
    |-- Rating display on search results can read from Convex
```

### Loading Library Page

```
User navigates to /library
    |
    v
AuthRouteGate (existing) -- blocks until authenticated
    |
    v
LibraryCommandCenter component
    |-- useProtectedPaginatedQuery(api.library.queries.listItems, {
    |     filters: { rating, collectionId, searchQuery, sortBy },
    |     paginationOpts
    |   })
    |
    v
Convex query (library/queries.ts)
    |-- requireAuth(ctx) --> userId
    |-- If searchQuery provided:
    |     db.query("libraryItems")
    |       .withSearchIndex("search_title", q =>
    |         q.search("title", searchQuery).eq("userId", userId)
    |       )
    |       .paginate(paginationOpts)
    |-- If no search, filter by rating/date:
    |     db.query("libraryItems")
    |       .withIndex("by_user_rating", q => q.eq("userId", userId).eq("rating", rating))
    |       .order("desc")
    |       .paginate(paginationOpts)
    |-- If filtering by collection:
    |     (1) Get collectionItems for collectionId
    |     (2) Resolve each libraryItemId via db.get()
    |     (3) Apply client-side rating filter if needed
    |
    v
Return paginated results to client
    |-- Each item includes itemData for full rendering
    |-- Client renders using existing paper-card components
```

### Collection Management

```
Create Collection:
  mutation: collections.mutations.create({ name, description?, color? })
  --> insert into collections, return collectionId

Add Item to Collection:
  mutation: collections.mutations.addItem({ collectionId, libraryItemId })
  --> (1) Verify user owns both collection and libraryItem
  --> (2) Check uniqueness via by_collection_item index
  --> (3) Insert into collectionItems
  --> (4) Increment collections.itemCount

Remove Item from Collection:
  mutation: collections.mutations.removeItem({ collectionId, libraryItemId })
  --> (1) Find junction row via by_collection_item index
  --> (2) Delete junction row
  --> (3) Decrement collections.itemCount

Delete Collection:
  mutation: collections.mutations.remove({ collectionId })
  --> (1) Delete all collectionItems for this collection
  --> (2) Delete the collection itself
  --> (Note: libraryItems remain -- they exist independently)
```

## Architectural Patterns

### Pattern 1: Optimistic Ratings via Convex Mutations

**What:** When the user rates a paper, call a Convex mutation directly. Convex's reactive system ensures the UI updates immediately on the client that triggered the mutation, and within milliseconds on other tabs/devices.

**When to use:** All rating operations.

**Trade-offs:** No need for separate optimistic UI layer (Convex handles this). However, the first rating on a new item must send the full Work JSON (~5-20KB) to Convex. Subsequent rating changes only send the new rating value (patch, not full replacement).

```typescript
// In RatingSelector component
const saveItem = useMutation(api.library.mutations.saveOrUpdateItem);

const handleRatingChange = async (rating: number | null) => {
  if (rating === null) {
    // Remove from library
    await removeItem({ openalexId: paperId });
  } else {
    // Save or update -- itemData only needed on first save
    await saveItem({ openalexId: paperId, rating, itemData: paperWork });
  }
};
```

### Pattern 2: Dual-Path Ratings (Convex + Zustand Fallback)

**What:** Signed-in users get server-persisted ratings via Convex. Anonymous users (or before auth settles) fall back to the existing Zustand localStorage store. The RatingSelector component checks auth state and routes accordingly.

**When to use:** The rating-selector component on search results pages where the user may or may not be signed in.

**Trade-offs:** Slightly more complex component logic, but preserves the existing anonymous experience. When a user signs in, a one-time migration could sync localStorage ratings to Convex (optional stretch goal).

```typescript
// Pseudocode for dual-path rating
function useRating(paperId: string) {
  const { phase } = useAuthReadiness();
  const zustandRating = useRatingsStore(s => s.ratings[paperId]);
  const convexItem = useOptionalAuthQuery(api.library.queries.getItemRating,
    phase === "authenticated" ? { openalexId: paperId } : "skip"
  );

  if (phase === "authenticated" && convexItem.data !== undefined) {
    return convexItem.data?.rating ?? null;
  }
  return zustandRating ?? null;
}
```

### Pattern 3: Search Index for Text Filtering

**What:** Use Convex's built-in full-text search on the `title` field of `libraryItems`. The search index automatically supports prefix matching for typeahead-style filtering.

**When to use:** When the user types in the search box on the /library page.

**Trade-offs:**
- Search results are ordered by relevance (BM25), not by saved date or rating. If the user wants to search AND sort by date, you must post-filter after search (collect up to 1024 results, then sort client-side).
- Only one search field per index. To search across title AND authors, either: (a) create two search indexes and merge results, or (b) combine title + authors into a single searchable string field.
- Recommendation: Use a single `searchableText` field combining title + first few authors, indexed once.

```typescript
// Alternative: combined search field
libraryItems: defineTable({
  // ...
  searchableText: v.string(),  // "Paper Title | Author1, Author2, Author3"
  // ...
}).searchIndex("search_items", {
  searchField: "searchableText",
  filterFields: ["userId", "rating"],
})
```

### Pattern 4: Pagination with `useProtectedPaginatedQuery`

**What:** The library page uses the existing `useProtectedPaginatedQuery` wrapper (from `lib/auth/use-auth-query.ts`) which already handles auth settlement, deferred state, and "load more" patterns. The Convex query uses `.paginate(paginationOpts)`.

**When to use:** The library items list on /library.

**Trade-offs:** This is the established pattern used by the extraction results page. No new abstraction needed. Infinite scroll or "Load More" button -- both work with this pattern.

```typescript
const {
  results, status, loadMore, isSettled, settlement
} = useProtectedPaginatedQuery(
  api.library.queries.listItems,
  { filters: currentFilters },
  { initialNumItems: 20 }
);
```

## Recommended Project Structure

### New Files

```
convex/
  library/
    mutations.ts       # saveOrUpdateItem, removeItem, updateRating
    queries.ts         # listItems (paginated), getItemRating, getItemByOpenalexId
  collections/
    mutations.ts       # create, rename, remove, addItem, removeItem
    queries.ts         # listCollections, getCollection, getCollectionItems

app/
  library/
    page.tsx           # /library route (auth-gated)

components/
  library-command-center/
    index.tsx          # Main shell (follows CommandCenter pattern)
    library-toolbar.tsx       # Search, filter controls, sort, view mode
    library-item.tsx          # Single library item card
    library-filters.tsx       # Rating filter, collection filter, date filter
    collection-manager.tsx    # Create/rename/delete collections dialog
    collection-picker.tsx     # Assign item to collections popover

lib/
  hooks/
    use-library-rating.ts    # Dual-path rating hook (Convex + Zustand fallback)
```

### Modified Files

```
convex/schema.ts              # Add 3 tables + indexes + search index
convex/lib/validators.ts      # Add libraryItem, collection validators
components/rating-selector.tsx # Wire to Convex mutation when authenticated
lib/store.ts                  # Keep Zustand ratings for anonymous fallback
app/layout.tsx                # Add /library to sidebar navigation
components/app-sidebar.tsx    # Add Library nav item
```

### Structure Rationale

- **`convex/library/` and `convex/collections/`**: Follows the existing domain module pattern (`convex/users/`, `convex/credits/`, `convex/extraction/`). Each domain owns its queries, mutations, and internal functions.
- **`components/library-command-center/`**: Follows the existing Command Center pattern used by bookmarks, search history, and extraction. Provides consistent UI shell with header, toolbar, and list sections.
- **`lib/hooks/use-library-rating.ts`**: Isolates the dual-path rating logic so `RatingSelector` stays simple and the hook can be tested independently.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k library items per user | Current design works perfectly. Paginated queries, search index handles filtering. |
| 1k-10k items per user | Still fine. Convex pagination handles this. Collection filtering via junction table may slow if a single collection has thousands of items -- but `.collect()` on junction rows + `db.get()` for each is O(N) and Convex optimizes this. |
| 10k+ items per user | Unlikely for academic tool. If needed: add composite indexes for common filter combos, consider caching collection membership counts. |

### Scaling Priorities

1. **First bottleneck: Collection filtering with large collections.** When filtering by collection, we query `collectionItems` by collectionId, then resolve each `libraryItemId`. For 500+ items in a collection, this is 500 `db.get()` calls. Mitigation: Convex batches these efficiently, but if it becomes an issue, paginate the junction table query itself.
2. **Second bottleneck: Search + sort conflict.** Convex search indexes return results in relevance order only. If users search AND want to sort by date, we must collect results (max 1024) and sort client-side. This is a Convex platform limitation, not a design flaw.

## Anti-Patterns

### Anti-Pattern 1: Storing Items as Array in User Document

**What people do:** Add a `library: v.array(v.any())` field to the `users` table.
**Why it's wrong:** Convex documents are capped at 1MB. Each Work is 5-20KB. At 50-200 items, you hit the limit. Also, every library read/write loads the entire array. No indexing, no pagination, no search.
**Do this instead:** Separate `libraryItems` table with per-item documents. Enables indexes, pagination, search, and independent reads/writes.

### Anti-Pattern 2: Using Collections as an Array Field on libraryItems

**What people do:** Add `collections: v.array(v.id("collections"))` to `libraryItems`.
**Why it's wrong:** You cannot efficiently query "all items in collection X" -- you'd have to scan all library items and check array membership. No index support for array-contains queries in Convex.
**Do this instead:** Junction table (`collectionItems`) with indexes on both foreign keys. O(1) lookup in either direction.

### Anti-Pattern 3: Duplicating Full Work JSON in Each Collection

**What people do:** Store a copy of the item data in `collectionItems` for convenience.
**Why it's wrong:** Data duplication, inconsistency risk (rating changes in libraryItems not reflected in copies), wasted storage.
**Do this instead:** Junction table stores only IDs. Resolve the full item via `db.get(libraryItemId)` when needed.

### Anti-Pattern 4: Client-Side Filtering of All Library Items

**What people do:** Fetch all items and filter in React.
**Why it's wrong:** Scales terribly. A user with 200 items sends 200 * 15KB = 3MB on every page load. No pagination benefit.
**Do this instead:** Server-side filtering via Convex indexes and search indexes. Only return the current page of results.

## Integration Points

### With Existing Rating System

| Aspect | Current (v2.0) | New (v2.1) | Migration |
|--------|----------------|------------|-----------|
| Storage | Zustand localStorage (`paper-ratings-store`) | Convex `libraryItems` table (authenticated) | Zustand remains as anonymous fallback |
| Rating values | `Record<string, number>` (paperId -> 0-5) | `libraryItems.rating` field (0-5) | Same range, same semantics |
| Where used | `RatingSelector`, `RatingRangePicker` (search filter) | Same components + /library page | RatingSelector modified to call mutation |
| Search filter | Zustand ratings applied client-side to search results | Still client-side for search results (ratings are per-session context) | No change to search filter behavior |

### With Existing Auth System

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Library mutations | `requireAuth(ctx)` from `convex/lib/auth.ts` | Every mutation verifies active user. Same pattern as extraction/credits. |
| Library queries | `getCurrentUser(ctx)` / `requireAuth(ctx)` | Queries return null or deny for unauthenticated users. |
| Route protection | `AuthRouteGate` in layout already gates routes | /library page needs to be added to protected routes list |
| Query wrappers | `useProtectedPaginatedQuery` from `lib/auth/use-auth-query.ts` | Handles auth_loading -> query_loading -> ready settlement |

### With Existing UI Patterns

| Pattern | Reuse | Notes |
|---------|-------|-------|
| Command Center shell | Full reuse | Header + Toolbar + List. Same as bookmarks, history, extraction. |
| Paper card components | Full reuse | `components/paper-card/` already renders Work objects. Library items carry the same data. |
| View mode toggle | Full reuse | List/grid toggle from `lib/store.ts` UI state (add `libraryViewMode`, `librarySortBy`). |
| PageWrapper | Full reuse | Standard page layout wrapper. |
| Sidebar navigation | Add entry | Add "Library" item to `components/app-sidebar.tsx`. |

### With Internationalization

| Aspect | Approach |
|--------|----------|
| Library page strings | Add `library` namespace to `messages/*.json` (6 locales) |
| Collection names | User-entered, not translated |
| Filter labels | Add to existing `searchFilters` namespace or new `libraryFilters` namespace |

## Suggested Build Order

Build order is driven by dependencies: tables must exist before queries/mutations, mutations before UI, and the library item concept before collections (which depend on library items existing).

| Phase | What | Why This Order |
|-------|------|----------------|
| 1 | Schema: Add `libraryItems` table + indexes + search index | Everything depends on this |
| 2 | `convex/library/mutations.ts`: saveOrUpdateItem, removeItem, updateRating | Core write path |
| 3 | `convex/library/queries.ts`: listItems (paginated + filtered), getItemRating | Core read path |
| 4 | `components/rating-selector.tsx`: Wire to Convex mutation (dual-path) | Connects existing UI to new backend |
| 5 | `app/library/page.tsx` + `components/library-command-center/`: Basic list with pagination | Dedicated page to view saved items |
| 6 | Library filtering: search, rating filter, sort, date filter | Full filtering on library page |
| 7 | Schema: Add `collections` + `collectionItems` tables | Collections depend on libraryItems |
| 8 | `convex/collections/mutations.ts`: CRUD + add/remove items | Collection write path |
| 9 | `convex/collections/queries.ts`: list, get, getItems | Collection read path |
| 10 | Collection UI: manager dialog, picker popover, filter by collection | End-to-end collection feature |

**Rationale:** Items 1-6 deliver a fully functional library with filtering. Items 7-10 layer collections on top. This lets you ship the library incrementally -- the core value (save + browse rated papers) is usable before collections are built.

## Sources

- [Convex Full Text Search Documentation](https://docs.convex.dev/search/text-search) -- search index definition, query API, filter expressions, pagination, relevance ordering, 1024-result scan limit
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) -- many-to-many junction table pattern, schema examples, query patterns
- [Convex Database Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) -- `getManyVia`, `getManyFrom` helpers from convex-helpers package
- [Convex Data Types](https://docs.convex.dev/database/types) -- document size limit (1MB), array cap (8,192), object cap (1,024), nesting depth (16)
- [Convex Schemas](https://docs.convex.dev/database/schemas) -- schema definition, `v.any()`, `v.record()` usage
- Existing codebase: `convex/schema.ts`, `convex/extraction/queries.ts` (pagination pattern), `lib/auth/use-auth-query.ts` (protected query wrappers), `lib/store.ts` (current Zustand ratings store), `components/rating-selector.tsx` (current rating UI)

---
*Architecture research for: Library & Collections integration into OpenAlex Count*
*Researched: 2026-02-28*
