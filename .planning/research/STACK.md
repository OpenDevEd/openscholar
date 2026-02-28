# Stack Research: v2.1 Library & Collections

**Domain:** Persistent user library with collections, full-text search, and filtering for an academic search app
**Researched:** 2026-02-28
**Confidence:** HIGH

## Context

This research covers ONLY what is needed for v2.1. The existing stack is validated and not re-researched:
- Next.js 16.1.6, Convex 1.32.0, Clerk auth, next-intl, Stripe billing, Playwright, Vitest, Zustand 5.0.5, nuqs 2.8.8

The v2.1 features are:
1. Rating an item auto-saves it to a Convex-backed library (full JSON entry)
2. Dedicated `/library` page with filtering (rating, collection, date saved, text search, sort)
3. Collection CRUD (create, rename, delete) with many-to-many item assignment
4. Remove items from library
5. Auth-gated (signed-in users only)

---

## Recommended Stack

### No New Dependencies Required

The existing stack covers every need for v2.1. This milestone requires **zero new npm packages**.

| Capability Needed | Already Installed | Version | Status |
|---|---|---|---|
| Backend data storage | `convex` | 1.32.0 | Full-text search indexes, pagination, compound indexes all supported |
| Relationship helpers | `convex-helpers` | 0.1.112 | Installed but unused -- `getManyVia`, `filter` ready to use |
| URL state for filters | `nuqs` | 2.8.8 | Already wired with `NuqsAdapter` in root layout |
| Client state (optimistic) | `zustand` | 5.0.5 | Already used for ratings store (`useRatingsStore`) |
| Auth-gated queries | `convex` + `@clerk/nextjs` | -- | `useProtectedQuery`, `useProtectedPaginatedQuery` already built in `lib/auth/use-auth-query.ts` |
| Date formatting | `date-fns` | 4.1.0 | Already installed |
| Icons | `lucide-react` | 0.487.0 | Already installed |
| UI components | Radix primitives + shadcn | -- | Full component library already in place |
| Pagination UI | CommandCenter components | -- | Reusable `CommandCenterPagination`, `CommandCenterList`, `CommandCenterToolbar` already exist |
| Toasts | `sonner` | 2.0.7 | Already installed, used throughout app |
| Analytics | `posthog-js` | 1.342.1 | Already installed, used for rating events |

### Core Technologies (Convex Patterns to Use)

| Pattern | Purpose | Why Recommended |
|---|---|---|
| Convex `searchIndex` | Full-text search within saved library items (title, abstract, authors) | Native Convex feature, reactive, no external search engine needed. Supports `.paginate()` and `filterFields` for scoped search. |
| Convex `.index()` compound indexes | Filtering by userId + rating, userId + savedAt for sort | Compound indexes enable efficient range queries; `_creationTime` auto-appended as tiebreaker. |
| Convex `.paginate()` + `usePaginatedQuery` | Infinite scroll or load-more on `/library` page | Cursor-based, reactive, already used in extraction queries. `useProtectedPaginatedQuery` wrapper already built. |
| Junction table pattern | Many-to-many: items belong to multiple collections | Standard Convex pattern for M:N. Separate `libraryItemCollections` table with indexes on both foreign keys. |
| `convex-helpers/server/relationships` `getManyVia` | Traversing item-to-collections and collection-to-items | Eliminates boilerplate for junction table queries. Already installed at 0.1.112, not yet imported anywhere. |
| `convex-helpers/server/filter` `filter` | Complex TypeScript filtering on paginated queries | Enables filtering by criteria not expressible in index range (e.g., combined OR conditions). Use with caution -- see limitations. |
| `nuqs` parsers | URL-driven filter/sort state on `/library` page | Already in use for pagination (`parseAsInteger`). Extend with `parseAsString`, `parseAsStringLiteral` for filter params. |

---

## Convex Schema Design

### New Tables

```typescript
// In convex/schema.ts -- ADD these three tables

// Library items -- one per user per saved paper
libraryItems: defineTable({
  userId: v.id("users"),
  openalexId: v.string(),              // OpenAlex work ID (dedup key)
  rating: v.number(),                   // 0-5 star rating
  title: v.string(),                    // Denormalized for display
  searchableText: v.string(),           // title + abstract + authors concatenated for search
  authors: v.optional(v.string()),      // Flattened author string for display
  publicationYear: v.optional(v.number()),
  doi: v.optional(v.string()),
  abstract: v.optional(v.string()),     // For display
  paperData: v.any(),                   // Full OpenAlex Work JSON blob
  savedAt: v.number(),                  // Timestamp when first saved
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_openalexId", ["userId", "openalexId"])    // Dedup: one item per user per paper
  .index("by_user_rating", ["userId", "rating"])             // Filter by rating
  .index("by_user_savedAt", ["userId", "savedAt"])           // Sort by date saved
  .index("by_user_year", ["userId", "publicationYear"])      // Sort by publication year
  .searchIndex("search_library", {
    searchField: "searchableText",                            // Full-text search on concatenated field
    filterFields: ["userId", "rating"],                       // Scope search to user, optionally filter by rating
  }),

// Collections -- user-created groupings
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),       // Optional color tag for UI
  itemCount: v.number(),               // Denormalized count for display
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_user_name", ["userId", "name"]),   // Uniqueness check + alphabetical listing

// Junction table: items <-> collections (many-to-many)
libraryItemCollections: defineTable({
  libraryItemId: v.id("libraryItems"),
  collectionId: v.id("collections"),
  addedAt: v.number(),
})
  .index("by_item", ["libraryItemId"])                        // "What collections is this item in?"
  .index("by_collection", ["collectionId"])                    // "What items are in this collection?"
  .index("by_item_collection", ["libraryItemId", "collectionId"]),  // Dedup check via .unique()
```

### Index Budget

`libraryItems` uses 5 regular indexes + 1 search index = 6 total (limit: 32 per table).
`collections` uses 2 regular indexes = 2 total.
`libraryItemCollections` uses 3 regular indexes = 3 total.

All well within Convex limits.

### Design Rationale

**Why denormalize title/authors/year onto `libraryItems`?**
Convex search indexes and regular indexes operate on fields within the same document. If the paper data were stored in a separate table, every query would require a join. Denormalizing the key searchable/filterable fields onto the library item document enables:
- Search index on `searchableText` with `userId` as filter field
- Compound indexes on `userId` + `rating`, `userId` + `savedAt`
- No joins for the common list/filter/sort operations

**Why `paperData: v.any()` for the full JSON?**
The OpenAlex `Work` type has 40+ optional fields (`abstract_inverted_index`, `authorships`, `apc_list`, `best_oa_location`, `biblio`, etc.). Defining each one in the Convex schema provides no value since this blob is only used for display/export, not querying. Using `v.any()` avoids schema churn as OpenAlex evolves. All queryable fields are denormalized as properly typed fields above it.

**Why `searchableText` (concatenated) instead of indexing `title` alone?**
Convex search indexes support exactly 1 `searchField`. A single concatenated field (`title + " " + abstract + " " + authors`) enables searching across all text with one index. Build this string at save time in the mutation, not at query time.

**Why junction table instead of array-of-IDs?**
- Arrays cannot be indexed in Convex -- no way to efficiently query "all items in collection X"
- Junction table enables efficient bidirectional queries via separate indexes
- Easy add/remove without read-modify-write races on the parent document
- Metadata per association (e.g., `addedAt` timestamp)
- `by_item_collection` compound index enables `.unique()` for dedup checks

**Why `itemCount` on `collections` (denormalized)?**
Counting items in a collection requires a full scan of `libraryItemCollections` filtered by `collectionId`. Denormalizing the count avoids this on every render. Increment/decrement atomically in the add/remove mutations.

---

## Key Convex Patterns

### Pattern 1: Rating Triggers Library Save (Upsert)

```typescript
// convex/library/mutations.ts
import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

export const saveToLibrary = mutation({
  args: {
    openalexId: v.string(),
    rating: v.number(),
    title: v.string(),
    authors: v.optional(v.string()),
    publicationYear: v.optional(v.number()),
    doi: v.optional(v.string()),
    abstract: v.optional(v.string()),
    paperData: v.any(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) throw new Error("Unauthenticated");

    const searchableText = [args.title, args.abstract, args.authors]
      .filter(Boolean)
      .join(" ");

    // Upsert: check if already in library
    const existing = await ctx.db
      .query("libraryItems")
      .withIndex("by_user_openalexId", (q) =>
        q.eq("userId", user._id).eq("openalexId", args.openalexId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rating: args.rating,
        paperData: args.paperData,
        searchableText,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("libraryItems", {
      userId: user._id,
      openalexId: args.openalexId,
      rating: args.rating,
      title: args.title,
      searchableText,
      authors: args.authors,
      publicationYear: args.publicationYear,
      doi: args.doi,
      abstract: args.abstract,
      paperData: args.paperData,
      savedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});
```

### Pattern 2: Search with User Scoping + Pagination

```typescript
// convex/library/queries.ts
export const searchLibrary = query({
  args: {
    searchQuery: v.string(),
    rating: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    return await ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (q) => {
        let search = q.search("searchableText", args.searchQuery).eq("userId", user._id);
        if (args.rating !== undefined) {
          search = search.eq("rating", args.rating);
        }
        return search;
      })
      .paginate(args.paginationOpts);
  },
});
```

### Pattern 3: Index-Based Filtering + Sorting (No Search Query)

```typescript
export const listLibrary = query({
  args: {
    sortBy: v.union(v.literal("savedAt"), v.literal("rating"), v.literal("year")),
    rating: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    let q;
    if (args.rating !== undefined) {
      q = ctx.db.query("libraryItems")
        .withIndex("by_user_rating", (idx) =>
          idx.eq("userId", user._id).eq("rating", args.rating!)
        );
    } else if (args.sortBy === "savedAt") {
      q = ctx.db.query("libraryItems")
        .withIndex("by_user_savedAt", (idx) => idx.eq("userId", user._id));
    } else if (args.sortBy === "year") {
      q = ctx.db.query("libraryItems")
        .withIndex("by_user_year", (idx) => idx.eq("userId", user._id));
    } else {
      q = ctx.db.query("libraryItems")
        .withIndex("by_user", (idx) => idx.eq("userId", user._id));
    }

    return await q.order("desc").paginate(args.paginationOpts);
  },
});
```

### Pattern 4: Two-Code-Path Strategy (Search vs Browse)

**Critical design decision:** Convex search queries always return results in **relevance order**. You cannot sort search results by date or rating. This means the `/library` page needs two distinct query paths:

1. **Search mode** (user typed a query): Use `withSearchIndex` -- results ordered by relevance
2. **Browse mode** (no search query): Use regular `withIndex` -- results ordered by the chosen sort field

The client switches between these based on whether `q` (search query) is non-empty. This is the standard Convex pattern for combining search with custom sort.

### Pattern 5: Many-to-Many with getManyVia

```typescript
import { getManyVia } from "convex-helpers/server/relationships";

// Get all collections for a library item
export const getItemCollections = query({
  args: { itemId: v.id("libraryItems") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    // Verify ownership
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== user._id) return { status: "no_access" as const };

    return await getManyVia(
      ctx.db,
      "libraryItemCollections",
      "collectionId",
      "by_item",
      args.itemId
    );
  },
});

// Get all items in a collection (with ownership check)
export const getCollectionItems = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== user._id) return { status: "no_access" as const };

    const links = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .collect();

    return await Promise.all(
      links.map((link) => ctx.db.get(link.libraryItemId))
    ).then((items) => items.filter(Boolean));
  },
});
```

### Pattern 6: Collection Filter on Library Page

When filtering by collection, query the junction table first, then fetch the items:

```typescript
export const listLibraryByCollection = query({
  args: {
    collectionId: v.id("collections"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    // Verify collection ownership
    const collection = await ctx.db.get(args.collectionId);
    if (!collection || collection.userId !== user._id) return { status: "no_access" as const };

    // Get item IDs in this collection
    const links = await ctx.db
      .query("libraryItemCollections")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .collect();

    // Fetch and return the items
    const items = await Promise.all(
      links.map((link) => ctx.db.get(link.libraryItemId))
    );

    return items.filter(Boolean);
    // Note: For collections with 100+ items, consider paginating the links query
    // and using getPage from convex-helpers for more control.
  },
});
```

---

## URL State Design for /library Page

Use `nuqs` parsers to keep all filter/sort state in the URL:

```typescript
// lib/library/url-state.ts
import { parseAsString, parseAsInteger, parseAsStringLiteral } from "nuqs";

export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  rating: parseAsInteger,                                                // null = all ratings
  collection: parseAsString,                                             // collection ID or null
  sort: parseAsStringLiteral(["savedAt", "rating", "year"] as const)
    .withDefault("savedAt"),
  page: parseAsInteger.withDefault(1),
};
```

This enables bookmarkable, shareable library views:
`/library?q=machine+learning&rating=4&sort=year`

The pattern is already established in the codebase -- `components/bookmarks-command-center/index.tsx` uses `parseAsInteger` with `useQueryState` for pagination, and `components/search-history-pagination.tsx` does the same.

---

## Integration Points

### Rating -> Library Save Bridge

Currently, `useRatingsStore` (Zustand, persisted to localStorage in `paper-ratings-store`) handles ratings client-only. For v2.1:

1. **Keep** `useRatingsStore` for optimistic UI (instant star display on search results)
2. **Add** a Convex `useMutation` call in the `RatingSelector` component's `handleRatingChange` to save/update the library item server-side
3. **Sync direction**: Rating change triggers Convex mutation. Library page reads from Convex (source of truth). Zustand ratings store becomes a write-through cache for the search results page.
4. **On page load**: For signed-in users, consider hydrating `useRatingsStore` from Convex library items so search results show correct saved ratings. Alternatively, query Convex for ratings of displayed results.

### Auth Gating

The existing `useProtectedQuery` and `useProtectedPaginatedQuery` hooks in `lib/auth/use-auth-query.ts` handle auth gating with the settlement state machine (`auth_loading` -> `query_loading` -> `ready`). Use these for all library queries.

The `/library` route should be added as a protected route. The sidebar already shows auth-dependent navigation.

### Existing UI Components to Reuse

| Component | Reuse For |
|---|---|
| `CommandCenterContainer` | Library page layout shell |
| `CommandCenterToolbar` | Filter bar with search input, sort dropdown, view mode toggle |
| `CommandCenterList` | Library items list with grid/list view modes |
| `CommandCenterPagination` | Page controls (if using page-based rather than infinite scroll) |
| `RatingSelector` | Inline rating display/edit on library items |
| `CommandCenterHeader` | Library page header with item count |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|---|---|---|
| Convex `searchIndex` for library search | External search (Algolia, Typesense) | Overkill for per-user library search. Convex search handles 1024 results per query, more than sufficient for a personal library. No infra cost or sync complexity. |
| Junction table for M:N | Array of collection IDs on item document | Arrays are not indexable in Convex. Junction table enables efficient bidirectional queries and avoids read-modify-write races. |
| `convex-helpers` `getManyVia` | Manual junction table traversal (query + Promise.all) | `getManyVia` reduces 3-4 lines to 1 with identical semantics. Already installed at 0.1.112. |
| `nuqs` for URL filter state | Zustand for filter state | Filters should survive page refresh and be shareable/bookmarkable. `nuqs` already established in the codebase for this. Zustand is correct for ephemeral client state only. |
| Denormalized fields on `libraryItems` | Separate papers table + joins | Convex search and regular indexes only work on the queried table's fields. Denormalization avoids N+1 queries on every list render. |
| `v.any()` for full paper JSON | Typed Convex schema for all 40+ Work fields | No query value from typing the blob. Only denormalized fields need types. `v.any()` avoids schema maintenance as OpenAlex API evolves. |
| `usePaginatedQuery` (infinite scroll) | `getPage` from convex-helpers | `getPage` is more powerful but more complex. The simpler `usePaginatedQuery` with `loadMore` is already used in extraction queries with the `useProtectedPaginatedQuery` wrapper. Use the established pattern. |
| Single `searchableText` field | Two separate search indexes on title and abstract | Convex allows 1 `searchField` per search index. A concatenated field gives best coverage in one index. Multiple search indexes would require multiple queries and result merging. |

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| New search libraries (Algolia, Meilisearch, Typesense) | Personal library is max hundreds of items per user. External search adds cost, latency, sync complexity for zero benefit. | Convex native `searchIndex` |
| `@tanstack/react-query` or SWR for library data | Library data lives in Convex, not a REST API. Convex queries are already reactive via subscriptions. Adding another data layer creates cache coherence problems. | Convex `useQuery` / `usePaginatedQuery` |
| Convex Ents (`@convex-dev/ents`) | Full ORM layer. This project has established patterns for direct Convex queries. Ents would add an abstraction boundary inconsistent with the rest of the codebase. | `convex-helpers` relationship helpers (already installed) |
| `convex-helpers` `getPage` for primary listing | More complex API intended for bidirectional scrolling and virtual scroll. `usePaginatedQuery` with `loadMore` is simpler and already established. | `usePaginatedQuery` + `useProtectedPaginatedQuery` wrapper |
| Keeping ratings only in Zustand localStorage | Ratings are ephemeral in localStorage today. v2.1 requires server-side persistence for the library feature. | Convex mutation on rating change, with Zustand as optimistic write-through cache |
| `filter()` from `convex-helpers` for primary pagination | Known issue (#864): `filter` + `paginate` returns variable page sizes -- pages may have fewer items than requested. For primary listing, use indexes. | Use `withIndex()` for all primary filters (rating, user). Reserve `filter()` only for rare secondary predicates that cannot be indexed. |
| Any new state management library | Zustand already handles client state. Convex handles server state with reactivity. No gap to fill. | Zustand (client) + Convex (server) |

---

## Convex Limitations to Respect

| Limitation | Impact | Mitigation |
|---|---|---|
| Search index: exactly 1 `searchField` per index | Cannot search title AND abstract as separate fields | Create `searchableText` field concatenating title + abstract + authors at save time |
| Search results: max 1024 per query | Library search capped at 1024 matching results | Acceptable for personal library. Users can narrow with filters. |
| Search results: always relevance-ordered | Cannot sort search results by date or rating | Two code paths: search mode (relevance order) vs browse mode (index-based custom sort) |
| `filter()` + `paginate()`: variable page sizes | Pages may have fewer items than requested when filter excludes many rows | Use `withIndex()` for primary filters. Only use `filter()` for non-indexable predicates. |
| 32 indexes per table | Must budget indexes for `libraryItems` | 5 regular + 1 search = 6 total. Plenty of headroom. |
| 16 filter fields per search index | Limited equality filters in search queries | Only need `userId` and `rating`. Well within limit. |
| No `.order()` after `.withSearchIndex()` | Search results are always relevance-ordered | Accept relevance order when searching. Use regular indexes when user wants custom sort without search. |

---

## Installation

```bash
# No new packages needed. Zero npm install commands.
# All required capabilities exist in the current dependency tree:
#   convex@1.32.0, convex-helpers@0.1.112, nuqs@2.8.8,
#   zustand@5.0.5, date-fns@4.1.0, sonner@2.0.7
```

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `convex` | 1.32.0 | `convex-helpers` 0.1.112 | Both current. Search indexes, pagination, compound indexes all stable. |
| `convex-helpers` | 0.1.112 | `convex` 1.32.0 | Import paths: `convex-helpers/server/relationships`, `convex-helpers/server/filter` |
| `nuqs` | 2.8.8 | Next.js 16.1.6 | `NuqsAdapter` already configured in root layout. `parseAsString`, `parseAsInteger`, `parseAsStringLiteral` all available. |
| `zustand` | 5.0.5 | React 19.2.4 | Persist middleware already in use for `useRatingsStore` |

---

## Sources

- [Convex Full Text Search docs](https://docs.convex.dev/search/text-search) -- searchIndex definition, filterFields, 1024 result limit, relevance ordering, 1 searchField per index (HIGH confidence)
- [Convex Indexes docs](https://docs.convex.dev/database/reading-data/indexes/) -- compound indexes, 32 per table limit, 16 fields per index, index ordering rules (HIGH confidence)
- [Convex Pagination docs](https://docs.convex.dev/database/pagination) -- `.paginate()`, `usePaginatedQuery`, cursor-based pagination, reactive page sizes (HIGH confidence)
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) -- junction table pattern for M:N, indexing strategies, composite index for dedup (HIGH confidence)
- [convex-helpers Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) -- `getManyVia`, `getManyFrom`, `getAll`, import from `convex-helpers/server/relationships` (HIGH confidence)
- [convex-helpers Complex Filters](https://stack.convex.dev/complex-filters-in-convex) -- `filter()` helper import and usage, hybrid index + filter pattern (HIGH confidence)
- [convex-helpers filter + pagination issue #864](https://github.com/get-convex/convex-helpers/issues/864) -- variable page sizes confirmed as expected behavior, not a bug (HIGH confidence)
- [convex-helpers npm](https://www.npmjs.com/package/convex-helpers) -- latest 0.1.107 on npm, 0.1.112 installed locally (HIGH confidence)
- [Convex Advanced Pagination (getPage)](https://stack.convex.dev/pagination) -- `getPage` helper capabilities, not needed for this use case (HIGH confidence)
- Direct codebase inspection: `convex/schema.ts` (existing 11 tables, index patterns), `lib/store.ts` (`useRatingsStore`), `lib/auth/use-auth-query.ts` (`useProtectedPaginatedQuery`), `components/bookmarks-command-center/index.tsx` (nuqs + pagination pattern), `components/rating-selector.tsx` (rating flow), `package.json` (all versions) -- HIGH confidence

---
*Stack research for: v2.1 Library & Collections*
*Researched: 2026-02-28*
