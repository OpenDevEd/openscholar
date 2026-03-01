# Phase 23: Core Library Page - Research

**Researched:** 2026-02-28
**Domain:** Convex paginated queries, dual-path search/browse strategy, Next.js page routing, auth-gated UI
**Confidence:** HIGH

## Summary

Phase 23 builds the `/library` page -- a dedicated route where authenticated users browse, search, filter, sort, and manage their saved papers. The schema and all indexes are already in place from Phase 22: `libraryItems` table with `by_user`, `by_user_rating`, `by_user_savedAt`, `by_user_year` regular indexes and a `search_library` search index on `searchableText` with `userId` and `rating` as filter fields. The `saveToLibrary` mutation exists. This phase adds: Convex query functions (two paths: search mode and browse mode), a `removeFromLibrary` mutation, the Next.js `/library` route with auth gating, and all UI components (list rows, search bar, rating filter, sort dropdown, load-more pagination, empty states, removal confirmation).

The critical architectural insight is LIB-11's dual-path query strategy. Convex search index queries **always return results in relevance order** -- custom sort is not supported on search queries. Therefore the library page must switch between two query paths: (1) **Search mode**: when the user has typed a search query, use `.withSearchIndex("search_library", ...)` which returns results in relevance order and supports pagination; (2) **Browse mode**: when there is no search query, use regular indexes (e.g., `by_user_savedAt`, `by_user_rating`, `by_user_year`) with `.order("asc"|"desc")` and `.paginate()` for custom sort. The client decides which query to call based on whether a search string is active.

The existing codebase provides all the building blocks: `useProtectedPaginatedQuery` in `lib/auth/use-auth-query.ts` wraps `usePaginatedQuery` with auth-readiness checks, the `AuthRouteGate` component already blocks non-public routes for unauthenticated users, `showConfirmation()` from `lib/confirmation.tsx` provides imperative confirmation dialogs, and the shadcn/radix UI component library (alert-dialog, dropdown-menu, select, input, button) covers all needed UI primitives. No new npm packages are required.

**Primary recommendation:** Build two Convex query functions (`searchLibrary` for search mode, `browseLibrary` for browse mode), a `removeFromLibrary` mutation, and a client-side query orchestrator that selects the correct path based on active search text. Use `useProtectedPaginatedQuery` for both paths with load-more pagination (20 items per batch).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Compact vertical list -- one row per item, not cards or table
- Each row shows: rating stars, title, authors, publication year, journal name, cited_by_count, open access badge
- Clicking a row expands it inline to reveal the abstract and a link to the full paper
- Three-dot overflow menu on each row for destructive actions (remove)
- Full-width search bar at the top of the page, above the list -- always visible
- Debounced live search (~300ms) -- results update as user types, no Enter required
- Searches by title, author, and abstract text via Convex search index
- Clickable star row -- click a star to filter by that rating and above (e.g., click 3 = show 3, 4, 5 star papers)
- Click the same star again to clear the filter
- "Sort by" dropdown with options: Date saved, Rating, Publication year
- Each option has asc/desc toggle
- "Load more" button at bottom of list (not infinite scroll, not numbered pages)
- 20 items per batch via Convex `.paginate()` cursor-based pagination
- Total item count displayed at top of page (e.g., "X papers in your library")
- Skeleton row placeholders mimicking list layout during initial fetch and load-more
- Illustration/icon + message ("Your library is empty") + CTA button linking to search
- Inline message: "No papers match your search/filters" with a "Clear filters" button
- Confirmation dialog: "Remove [Paper Title] from your library?" with Cancel/Remove buttons
- Triggered from three-dot menu on the list row
- Unauthenticated users visiting /library are immediately redirected to sign-in page with return URL
- After sign-in, user lands back on /library

### Claude's Discretion
- Exact spacing, typography, and color choices within existing design system
- Skeleton animation style
- Empty state illustration choice
- Dual-path query strategy implementation details (search mode vs browse mode switching)
- How sort direction toggle is presented in the dropdown
- Debounce timing fine-tuning

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIB-03 | User can view all saved items on a dedicated `/library` page | Next.js app directory route at `app/library/page.tsx`, `AuthRouteGate` handles auth gating at layout level, browse mode query uses `by_user_savedAt` index with `.paginate()` |
| LIB-04 | User can search within their library by title, author, or abstract text via Convex search index | `search_library` search index already defined on `searchableText` field with `userId` filter. Search mode query uses `.withSearchIndex("search_library", q => q.search("searchableText", query).eq("userId", userId))` |
| LIB-05 | User can filter library items by rating value | Search mode: `search_library` index has `rating` as a filter field, use `.eq("rating", value)` for exact rating or multiple queries. Browse mode: `by_user_rating` index for index-driven filtering, or `convex-helpers/server/filter` for "rating >= N" predicate on paginated queries |
| LIB-06 | User can sort library by date saved, rating, or publication year | Browse mode only (search mode is relevance-ordered). Three indexes: `by_user_savedAt`, `by_user_rating`, `by_user_year` with `.order("asc"|"desc")` |
| LIB-07 | User can remove items from their library with confirmation | New `removeFromLibrary` mutation with `requireAuth` + ownership check. Client uses `showConfirmation()` imperative dialog from `lib/confirmation.tsx` |
| LIB-08 | Library page is auth-gated -- unauthenticated users are redirected to sign-in | `/library` is NOT in `PUBLIC_UNAUTHENTICATED_PATHS` in `lib/auth/public-routes.ts`, so `AuthRouteGate` automatically shows sign-in prompt. Server-side: queries use `requireAuth()` |
| LIB-09 | Library page shows helpful empty state when no items are saved | Client checks if results array is empty AND no filters are active. Renders empty state with icon, message, and CTA link to search |
| LIB-10 | Library items are paginated server-side via Convex `.paginate()` | Both search and browse queries accept `paginationOpts` via `paginationOptsValidator`. Client uses `useProtectedPaginatedQuery` with `initialNumItems: 20` and `loadMore(20)` |
| LIB-11 | Dual-path query strategy: search mode (relevance order via searchIndex) vs browse mode (custom sort via regular index) | Two separate Convex query functions. Client switches based on whether search text is non-empty. Search path uses `.withSearchIndex()`, browse path uses `.withIndex().order().paginate()` |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | ^1.31.7 | Backend queries, mutations, pagination, search index | Already the project's backend. `.paginate()`, `.withSearchIndex()`, `paginationOptsValidator` all native features |
| `convex/react` | (bundled) | `usePaginatedQuery` via `useProtectedPaginatedQuery` wrapper | Already built in `lib/auth/use-auth-query.ts` with auth-readiness gating |
| `next` | 16.x | App directory routing for `/library` page | Already the project's framework |
| `@clerk/nextjs` | ^6.38.2 | Authentication state for auth gating | Already provides auth context used by `AuthRouteGate` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-helpers` | 0.1.112 | `filter()` for rating >= N predicate on paginated browse queries | When rating filter needs "N and above" instead of exact match. Already installed, not yet imported |
| `lucide-react` | 0.487.0 | Icons for empty states, search, overflow menu, sort indicators | Already used throughout the app |
| `next-intl` | ^4.8.2 | Translations for library page strings | Already wired in layout. Add `libraryPage` key to message files |
| `sonner` | ^2.0.7 | Toast notifications for removal confirmation | Already installed and used app-wide |
| `motion/react` | ^12.23.12 | Expand/collapse animation for inline row detail | Already used in auth panels and sidebar. AnimatePresence for row expansion |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two separate query functions (search/browse) | Single query with conditional logic | Two functions is cleaner: each has clear types, validators, and index strategy. Single function would need complex conditional return types and couldn't properly validate different args |
| `convex-helpers/server/filter` for rating >= N | Client-side post-filter after paginate | `convex-helpers` filter works WITH pagination cursor, though pages may be undersized. Client-side filter would always show full pages but requires over-fetching. Recommendation: use `convex-helpers` filter for browse mode |
| `showConfirmation()` imperative dialog | Inline dialog state in each row component | Imperative pattern already exists and is used app-wide. No per-row state management needed |
| Separate count query | Aggregate component | Aggregate component adds complexity. For MVP, a separate `.collect()` count query is acceptable for libraries under ~1000 items. Can optimize later if needed |

**Installation:**
```bash
# No new packages needed. Zero npm install commands.
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── library/
│   └── page.tsx                     # Server component with metadata, renders client page
convex/
├── library/
│   ├── mutations.ts                 # EXISTING: saveToLibrary; ADD: removeFromLibrary
│   └── queries.ts                   # NEW: searchLibrary, browseLibrary, getLibraryCount
components/
├── library/
│   ├── library-page-client.tsx      # Main client component, orchestrates search/browse
│   ├── library-search-bar.tsx       # Full-width debounced search input
│   ├── library-filters.tsx          # Rating star filter + sort dropdown
│   ├── library-item-row.tsx         # Compact list row with expand/collapse
│   ├── library-item-skeleton.tsx    # Skeleton placeholder row
│   ├── library-empty-state.tsx      # Empty library / no results states
│   └── library-remove-dialog.tsx    # Uses showConfirmation() pattern (or inline)
lib/
├── hooks/
│   └── use-debounce.ts              # Debounce hook (check if exists, common utility)
```

### Pattern 1: Dual-Path Query Strategy (LIB-11)

**What:** Two Convex query functions with a client-side orchestrator that selects which to call based on search state.

**When to use:** Whenever text search and custom sort are both required. Convex search indexes always return relevance-ordered results; custom sort requires regular indexes.

**Search mode query:**
```typescript
// convex/library/queries.ts
import { query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";

export const searchLibrary = query({
  args: {
    searchText: v.string(),
    minRating: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    let q = ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (q) => {
        let search = q.search("searchableText", args.searchText)
          .eq("userId", user._id);
        // Note: search index filter only supports exact .eq(), not .gte()
        // For "rating >= N", additional filtering needed
        return search;
      });

    return await q.paginate(args.paginationOpts);
  },
});
```

**Browse mode query:**
```typescript
export const browseLibrary = query({
  args: {
    sortBy: v.union(
      v.literal("savedAt"),
      v.literal("rating"),
      v.literal("publicationYear")
    ),
    sortOrder: v.union(v.literal("asc"), v.literal("desc")),
    minRating: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const indexMap = {
      savedAt: "by_user_savedAt",
      rating: "by_user_rating",
      publicationYear: "by_user_year",
    } as const;

    let q = ctx.db
      .query("libraryItems")
      .withIndex(indexMap[args.sortBy], (q) => q.eq("userId", user._id))
      .order(args.sortOrder);

    // If rating filter active, apply convex-helpers filter
    if (args.minRating !== undefined) {
      const { filter } = await import("convex-helpers/server/filter");
      return await filter(q, (item) => item.rating >= args.minRating!)
        .paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});
```

**Client-side orchestrator:**
```typescript
// In library-page-client.tsx
const hasSearchText = debouncedSearch.trim().length > 0;

const searchResults = useProtectedPaginatedQuery(
  api.library.queries.searchLibrary,
  hasSearchText ? { searchText: debouncedSearch, minRating, paginationOpts: {} } : "skip",
  { initialNumItems: 20 },
);

const browseResults = useProtectedPaginatedQuery(
  api.library.queries.browseLibrary,
  !hasSearchText ? { sortBy, sortOrder, minRating, paginationOpts: {} } : "skip",
  { initialNumItems: 20 },
);

// Active result set is whichever query is not skipped
const activeResults = hasSearchText ? searchResults : browseResults;
```

### Pattern 2: Rating Filter with Search Index Limitation

**What:** The `search_library` search index has `rating` as a filter field, but it only supports exact `.eq()` matching, not range queries. The user decision says "click 3 = show 3, 4, 5 star papers" (a >= filter).

**How to handle:**

For **browse mode** (no search text): Use `convex-helpers/server/filter` with a `rating >= N` predicate on the paginated query. This scans the index and applies the predicate before returning pages. Pages may be slightly undersized, but the cursor continues correctly.

For **search mode** (with search text): The search index filter field only supports `.eq()`. Two options:
1. **Post-filter on the paginated result** (simple, may give undersized pages)
2. **Multiple OR queries** -- not supported by Convex in a single query

Recommendation: Use `convex-helpers/server/filter` wrapping the search query for consistency. The `filter()` function works with `.withSearchIndex()` queries -- the source code confirms it wraps any `OrderedQuery` and its `paginate()` calls `result.page` through the async filter.

```typescript
// Search + rating filter
import { filter } from "convex-helpers/server/filter";

let q = ctx.db.query("libraryItems")
  .withSearchIndex("search_library", (sq) =>
    sq.search("searchableText", args.searchText).eq("userId", user._id)
  );

if (args.minRating !== undefined) {
  return await filter(q, (item) => item.rating >= args.minRating!)
    .paginate(args.paginationOpts);
}
return await q.paginate(args.paginationOpts);
```

**Caveat:** With `convex-helpers` filter + paginate, page sizes may be less than requested (e.g., request 20, get 15 after filtering). The cursor still advances correctly and `usePaginatedQuery` handles this transparently -- the "Load more" button still works because `status` reports `"CanLoadMore"` until all results are exhausted.

### Pattern 3: Expandable List Row

**What:** Each row is a compact single-line item. Clicking it expands inline to show abstract and full paper link.

**Implementation:**
```typescript
function LibraryItemRow({ item }: { item: Doc<"libraryItems"> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setExpanded(!expanded)}
      onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
      className="border-b border-border/40 hover:bg-muted/50 transition-colors"
    >
      {/* Compact row: rating, title, authors, year, journal, citations, OA badge */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* ... row content ... */}
        {/* Three-dot menu - stop propagation to prevent row expand */}
        <DropdownMenu>
          <DropdownMenuTrigger onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleRemove(item)}>Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="px-4 pb-3 text-sm text-muted-foreground">
              <p>{item.abstract}</p>
              {item.doi && (
                <a href={item.doi} target="_blank" rel="noopener noreferrer">
                  View full paper
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### Pattern 4: Auth Gate (LIB-08)

**What:** `/library` must be auth-gated. Unauthenticated users redirect to sign-in.

**How it already works:** The `AuthRouteGate` component in the root layout checks `isPublicPath(pathname)`. If the path is NOT in `PUBLIC_UNAUTHENTICATED_PATHS` and the user is not authenticated, it shows the sign-in panel. `/library` is NOT in the public paths list, so it is **already auth-gated by default**. No additional work needed at the route level.

Server-side defense-in-depth: All library queries use `requireAuth(ctx)` which throws `UNAUTHENTICATED` if no identity is present.

### Anti-Patterns to Avoid

- **Single query with client-side sort switching:** Do NOT fetch all items via one query and sort in JavaScript. Convex indexes are the sort mechanism.
- **Full table scan for filtered pagination:** Do NOT use `.paginate()` on the full table then filter. Use index-driven queries or `convex-helpers` filter.
- **Storing UI filter state only in React state:** Sort/filter state should be lifted to URL params (Phase 24 adds nuqs). For Phase 23, local React state is acceptable but keep the state shape ready for nuqs migration.
- **Fetching the total count via `.collect().length`:** This loads ALL documents. Use a separate lightweight count query with `.collect()` only when the library is expected to be small (< ~1000). For large libraries, consider the Aggregate component later.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced search input | Custom setTimeout/clearTimeout logic | `useDeferredValue` or a `useDebounce` hook | React 19's `useDeferredValue` is simpler; alternatively a 10-line hook avoids bugs with stale closures |
| Confirmation dialog | Per-component dialog state | `showConfirmation()` from `lib/confirmation.tsx` | Already built, imperative API, handles queuing, uses the global `ConfirmationHost` |
| Auth-gated routes | Custom redirect logic per page | `AuthRouteGate` + `PUBLIC_UNAUTHENTICATED_PATHS` | Already in root layout, `/library` just needs to NOT be in the public list |
| Paginated queries with auth | Raw `usePaginatedQuery` | `useProtectedPaginatedQuery` from `lib/auth/use-auth-query.ts` | Handles auth readiness, deferred state, settlement tracking |
| Pagination cursor management | Manual cursor state | `usePaginatedQuery` / `useProtectedPaginatedQuery` | Convex hook manages cursors internally, returns `loadMore` and `status` |

**Key insight:** This phase is primarily a UI assembly task. The backend schema, indexes, and save mutation exist. The auth infrastructure exists. The UI primitive components exist. The main engineering challenge is the dual-path query design and the UX polish of the list/filter/search interaction.

## Common Pitfalls

### Pitfall 1: Mixing Search Index and Custom Sort

**What goes wrong:** Developer tries to add `.order("desc")` to a `.withSearchIndex()` query, expecting results sorted by date. Convex silently ignores the `.order()` call on search queries -- results always come back in relevance order.

**Why it happens:** The API allows chaining `.order()` after `.withSearchIndex()` without a TypeScript error, but the sort is not applied.

**How to avoid:** Never chain `.order()` on search queries. Use the dual-path strategy: search mode = relevance order, browse mode = custom sort via regular indexes.

**Warning signs:** Sort dropdown appears to do nothing when search text is active.

### Pitfall 2: Rating Filter with Search Index eq-Only Constraint

**What goes wrong:** Developer tries `q.gte("rating", 3)` in the search index filter. This fails because search index filter fields only support `.eq()`.

**Why it happens:** Regular index queries support range operators (`.gte()`, `.lte()`), but search index filter fields are equality-only.

**How to avoid:** Use `convex-helpers/server/filter` to apply rating >= N as a JavaScript predicate that wraps the paginated search query. Accept that pages may be undersized.

**Warning signs:** TypeScript error on `.gte()` in search filter, or runtime error from Convex.

### Pitfall 3: Total Count Performance

**What goes wrong:** Displaying "X papers in your library" requires knowing the total count. A naive approach uses a query that `.collect()`s all items and returns `.length`. For a library with 2000 items, this reads 2000 documents per reactive update.

**Why it happens:** Convex has no built-in `COUNT(*)`. The only way to count is to read documents.

**How to avoid:** For Phase 23 (MVP), use a separate count query that does `.collect()` on the `by_user` index and returns `.length`. This is acceptable for libraries up to ~1000 items. For optimization: (a) the Convex Aggregate component provides O(log n) counts but adds dependency complexity, or (b) maintain a denormalized `libraryItemCount` field on the user document, incremented/decremented in save/remove mutations.

**Recommendation for Phase 23:** Use the simple `.collect().length` approach. The 1024-document collect limit is a concern. If libraries may exceed 1024, use a loop with `.take(1024)` + cursor to count, or add a denormalized counter.

**Updated recommendation:** Since Convex `.collect()` has a 1024-document limit, use a manual count approach:
```typescript
export const getLibraryCount = query({
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return items.length;
  },
});
```
This works for libraries up to 1024 items. For larger libraries, maintain a denormalized count on the users table.

### Pitfall 4: Stale Skeleton Flash on Query Path Switch

**What goes wrong:** When user types in the search bar, the client switches from `browseLibrary` (skipped) to `searchLibrary` (active). The new query loads fresh, showing `LoadingFirstPage` status. If the skeleton renders, the user sees a flash of skeleton rows every time they type.

**Why it happens:** `useProtectedPaginatedQuery` returns `isInitialLoading: true` for a fresh query. The old browse results are discarded when that query is skipped.

**How to avoid:** Keep the previous results visible during the transition. Use a "stale while reloading" pattern: store the last results in a ref and show them with a subtle loading indicator (e.g., opacity reduction or spinner) until the new query settles.

### Pitfall 5: Forgetting to Exclude Library from Public Paths

**What goes wrong:** Developer adds `/library` to `PUBLIC_UNAUTHENTICATED_PATHS` during development to test the page without signing in, then forgets to remove it.

**Why it happens:** The auth gate is "deny by default" (any path not in the list is gated). But if someone adds it to the list for convenience, it silently becomes public.

**How to avoid:** `/library` must NOT be added to `PUBLIC_UNAUTHENTICATED_PATHS`. Verify this in the implementation. The `AuthRouteGate` handles the redirect automatically.

### Pitfall 6: Not Handling the Search Index 1024 Scan Limit

**What goes wrong:** Search index queries scan up to 1024 documents. If a user has 2000 items and searches for a common word, they may not see all matching results.

**Why it happens:** Convex search index has a 1024-document scan limit.

**How to avoid:** This is acceptable for Phase 23 MVP. The search returns the top 1024 most relevant results. For most users with < 500 items, this is not a practical issue. Document this limitation.

## Code Examples

### Remove From Library Mutation

```typescript
// convex/library/mutations.ts -- ADD to existing file
export const removeFromLibrary = mutation({
  args: {
    itemId: v.id("libraryItems"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const item = await ctx.db.get(args.itemId);

    if (!item) {
      throw createError("NOT_FOUND", "Library item not found");
    }
    if (item.userId !== user._id) {
      throw createError("FORBIDDEN", "Not your library item");
    }

    await ctx.db.delete(args.itemId);
    return null;
  },
});
```

### Client-Side Removal with Confirmation

```typescript
import { showConfirmation } from "@/lib/confirmation";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

function useRemoveFromLibrary() {
  const removeItem = useMutation(api.library.mutations.removeFromLibrary);

  return (item: Doc<"libraryItems">) => {
    showConfirmation({
      title: "Remove from library",
      message: `Remove "${item.title}" from your library?`,
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "destructive",
      onConfirm: () => {
        removeItem({ itemId: item._id }).catch((err) => {
          console.error("[Library] Failed to remove:", err);
          toast.error("Failed to remove item");
        });
      },
    });
  };
}
```

### Debounced Search Hook

```typescript
import { useState, useEffect } from "react";

function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
```

### Library Count Query

```typescript
// convex/library/queries.ts
export const getLibraryCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    const items = await ctx.db
      .query("libraryItems")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return items.length;
  },
});
```

### Page Component Structure

```typescript
// app/library/page.tsx
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LibraryPageClient } from "@/components/library/library-page-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("libraryTitle"),
    description: t("libraryDescription"),
  };
}

export default function LibraryPage() {
  return <LibraryPageClient />;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `v.any()` for paper data blob | Slim typed fields (Phase 22 decision) | Phase 22 | Documents are 800-1200 bytes instead of 5-20 KB |
| Single search index for all | Dual-path: search index + regular indexes | Convex architecture constraint | Must use two query paths since search index cannot custom-sort |
| Client-side pagination (in-memory slicing) | Server-side cursor pagination via `.paginate()` | This phase | Scales to thousands of items without loading all into memory |
| localStorage-only ratings | Convex-backed library + localStorage fallback | Phase 22 | Library page can display server-persisted items |

**Deprecated/outdated:**
- Using `.filter()` chain method for complex predicates: Use `convex-helpers/server/filter` function instead for JS-level predicates that work with pagination
- Client-side `filteredResults.slice()` for pagination: Replaced by Convex `.paginate()` for library items

## Open Questions

1. **Total count for large libraries (> 1024 items)**
   - What we know: Convex `.collect()` has a 1024-document limit. Libraries exceeding this cannot use simple `.collect().length`.
   - What's unclear: How many items typical users will have in their library by v2.1 launch.
   - Recommendation: Start with `.collect().length` (works up to 1024). If libraries grow beyond this, add a denormalized `libraryItemCount` field on the users table or use the Convex Aggregate component. This can be a fast follow-up.

2. **Undersized pages with rating filter + pagination**
   - What we know: `convex-helpers/server/filter` passes pages through the predicate after `paginate()` fetches them. A page of 20 may shrink to 12 after filtering.
   - What's unclear: Whether this UX degradation is noticeable for typical filter patterns.
   - Recommendation: Accept undersized pages for Phase 23. The "Load more" button still works correctly. If UX feedback is poor, Phase 24 can switch to a denormalized approach or separate per-rating-level indexes.

3. **Sidebar navigation item**
   - What we know: The sidebar currently has Home, Bookmarks, History, and conditionally Extraction. There is no Library entry yet.
   - What's unclear: Whether Library replaces Bookmarks or sits alongside it.
   - Recommendation: Add Library as a new sidebar nav item using `Library` or `BookMarked` icon from lucide-react. Keep Bookmarks separate since it serves a different purpose (localStorage-based).

## Sources

### Primary (HIGH confidence)
- Convex Full Text Search docs (https://docs.convex.dev/search/text-search) - Confirmed: search queries always return relevance order, filter fields support `.eq()` only, 1024-document scan limit, 16 filter field max
- Convex Pagination docs (https://docs.convex.dev/database/pagination) - Confirmed: cursor-based, reactive, `usePaginatedQuery` hook, page size may change reactively
- Codebase analysis: `convex/schema.ts` lines 633-658 -- `libraryItems` table with all indexes and search index already defined
- Codebase analysis: `convex/library/mutations.ts` -- `saveToLibrary` mutation already exists with upsert logic
- Codebase analysis: `lib/auth/use-auth-query.ts` -- `useProtectedPaginatedQuery` wrapper already built with auth-readiness integration
- Codebase analysis: `lib/auth/public-routes.ts` -- `/library` is NOT in public paths, so auth gate works automatically
- Codebase analysis: `lib/confirmation.tsx` -- `showConfirmation()` imperative dialog API already built
- Codebase analysis: `convex-helpers/server/filter.ts` -- Confirmed `filter()` works with `.withSearchIndex()` and `.paginate()`, wraps `OrderedQuery`

### Secondary (MEDIUM confidence)
- Phase 22 research (`.planning/phases/22-schema-rating-bridge/22-RESEARCH.md`) - Schema design decisions, index strategy rationale
- Pre-research PITFALLS.md (`.planning/research/PITFALLS.md`) - Pagination + filter undersized page problem documented
- Pre-research STACK.md (`.planning/research/STACK.md`) - `convex-helpers` filter and relationship helpers identified

### Tertiary (LOW confidence)
- Total count performance threshold: The 1024-document `.collect()` limit is documented, but the performance impact of counting 500-1000 items per reactive query update has not been benchmarked in this specific codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed, no new dependencies, patterns verified in codebase
- Architecture: HIGH - Dual-path strategy is the only correct approach given Convex search index sort limitation (confirmed in official docs)
- Pitfalls: HIGH - All pitfalls verified against Convex documentation and codebase analysis
- UI patterns: HIGH - All needed components (dropdown-menu, alert-dialog, select, input) exist in shadcn library

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- Convex search/pagination APIs are mature)
