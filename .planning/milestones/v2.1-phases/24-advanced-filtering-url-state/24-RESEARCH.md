# Phase 24: Advanced Filtering & URL State - Research

**Researched:** 2026-02-28
**Domain:** nuqs URL state management, Convex server-side date/year filtering, view mode switching, date-fns timestamp computation
**Confidence:** HIGH

## Summary

Phase 24 adds three capabilities to the existing library page: (1) date-based and year-based filtering of library items, (2) URL persistence of all filter/sort/search state via `nuqs`, and (3) a view mode toggle (list-detail vs grid). The library page from Phase 23 already has working search, rating filter, sort controls, and pagination -- all using React `useState`. This phase replaces that local state with `nuqs` URL state parsers, adds new filter UI controls, and extends the Convex browse/search queries to accept date and year range parameters.

The project already has extensive `nuqs` usage. The `NuqsAdapter` is configured in the root layout (`app/layout.tsx`), the search results page uses `useQueryStates` with a comprehensive parser map (`lib/search-params/parsers.ts`), and simpler pages use individual `useQueryState` calls. The `nuqs` package is installed at v2.6.0 and exports all needed parsers including `parseAsStringLiteral`, `parseAsInteger`, `parseAsString`, and `parseAsIsoDateTime`. No new npm packages are needed.

For date filtering (FILT-01), the "date saved" filter uses preset ranges (last week, last month, last year) rather than free-form date pickers. These presets map to a URL param like `?saved=week` which the client converts to a timestamp threshold using `date-fns` (`subWeeks`, `subMonths`, `subYears`). The Convex query then filters with `item.savedAt >= threshold` using the existing `convex-helpers/server/filter` pattern. For publication year filtering (FILT-02), the URL stores `?yf=2020&yt=2024` and the query filters with `item.publicationYear >= yf && item.publicationYear <= yt`. Both filters stack on top of the existing rating filter. View mode (FILT-05) is simpler: a `?view=list` or `?view=grid` param controlling layout, reusing the existing `ViewModeToggleCompact` pattern adapted for two modes.

**Primary recommendation:** Create a `lib/library/search-params.ts` file defining all library URL parsers. Replace `useState` calls in `library-page-client.tsx` with `useQueryStates`. Extend `browseLibrary` and `searchLibrary` Convex queries to accept optional `savedAfter` (timestamp), `yearFrom`, and `yearTo` parameters. Add filter UI components for date presets and year range. Add a two-option view mode toggle to the filters bar.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | User can filter library items by date saved (e.g., last week, last month, last year) | Preset-based filter using `parseAsStringLiteral(["week", "month", "year"] as const)` in URL. Client converts preset to timestamp via `date-fns` (`subWeeks(now,1).getTime()`). Convex query accepts `savedAfter: v.optional(v.number())` and filters via `convex-helpers/server/filter` with `item.savedAt >= savedAfter`. Existing `by_user_savedAt` index already covers this path. |
| FILT-02 | User can filter library items by publication year range | Two URL params: `yf` (year from) and `yt` (year to) using `parseAsInteger`. Convex query accepts `yearFrom: v.optional(v.number())` and `yearTo: v.optional(v.number())`. Filter via `convex-helpers/server/filter` with `item.publicationYear >= yearFrom && item.publicationYear <= yearTo`. Works on both browse and search paths. |
| FILT-04 | All filter and sort state is persisted in the URL via nuqs (bookmarkable views) | `useQueryStates` replaces all `useState` calls in `library-page-client.tsx`. Parser map: `q` (search), `sort` (sortBy), `order` (sortOrder), `rating` (minRating), `saved` (date saved preset), `yf`/`yt` (year range), `view` (view mode). `NuqsAdapter` already configured in root layout. Pattern matches existing `lib/search-params/parsers.ts`. |
| FILT-05 | User can switch between view modes (list-detail / grid) | URL param `view` with `parseAsStringLiteral(["list", "grid"] as const).withDefault("list")`. Two-button toggle using `LayoutList` and `LayoutGrid` icons from lucide-react. List mode renders existing `LibraryItemRow` components. Grid mode renders a new `LibraryItemCard` component with paper metadata in card layout. Existing `ViewModeToggleCompact` and `GRID_CLASSES` from `lib/constants/view-modes.ts` provide the pattern. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `nuqs` | 2.6.0 | URL-based state management for all filter/sort/search params | Already installed and used extensively. `NuqsAdapter` configured in root layout. `parseAsStringLiteral`, `parseAsInteger`, `parseAsString` all available. |
| `convex` | ^1.31.7 | Server-side query filtering with date/year range predicates | Already the project backend. Queries extended with new filter args. |
| `convex-helpers` | ^0.1.111 | `filter()` for multi-predicate filtering on paginated queries | Already imported in `convex/library/queries.ts` for rating filter. Extended to compose date and year predicates. |
| `date-fns` | ^4.1.0 | Client-side timestamp computation for date presets (subWeeks, subMonths, subYears) | Already installed. Used elsewhere for date formatting. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | ^0.487.0 | Icons for view mode toggle (LayoutList, LayoutGrid), filter controls (Calendar, SlidersHorizontal) | Already used throughout the app |
| `next-intl` | ^4.8.2 | i18n for new filter labels (date presets, year range, view mode) | Already wired. Add new keys to `libraryPage` section in all 6 locale files |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Preset date ranges (week/month/year) | Free-form date picker | Presets are simpler UX and URL-friendly (`?saved=week` vs `?saved=2026-02-21`). Date picker adds complexity for minimal value -- users rarely need exact "saved after Feb 21" filtering |
| `convex-helpers/server/filter` for date/year | Convex index range queries | Index range queries would require compound indexes like `["userId", "savedAt", "publicationYear"]` which conflict with sort direction. `filter()` composes cleanly with existing index strategy at the cost of potential undersized pages (already accepted in Phase 23 for rating filter) |
| URL state via `nuqs` | Zustand persisted state | URL state is shareable, bookmarkable, and survives page refresh without localStorage. Zustand is already used for view modes elsewhere but FILT-04 explicitly requires URL persistence |
| Two view modes (list/grid) | Four view modes (list-simple, list-detail, grid-2, grid-3) | The requirement says "list-detail and grid view modes" -- two modes is sufficient. The existing search results page has four modes but the library's compact row layout makes simple-list redundant, and two grid variants are unnecessary for a personal library |

**Installation:**
```bash
# No new packages needed. Zero npm install commands.
```

## Architecture Patterns

### Recommended Project Structure
```
lib/
├── library/
│   └── search-params.ts          # NEW: nuqs parsers for library URL state
components/
├── library/
│   ├── library-page-client.tsx   # MODIFY: useState -> useQueryStates
│   ├── library-filters.tsx       # MODIFY: add date preset, year range, view mode controls
│   ├── library-item-card.tsx     # NEW: grid view card component
│   ├── library-view-toggle.tsx   # NEW: list/grid toggle (or inline in filters)
│   └── (existing files unchanged)
convex/
├── library/
│   └── queries.ts                # MODIFY: add savedAfter, yearFrom, yearTo args
messages/
├── en-US.json                    # MODIFY: add new i18n keys to libraryPage
├── (5 other locale files)        # MODIFY: same keys
```

### Pattern 1: Library URL Parsers Module

**What:** A dedicated parser map for all library page URL state, following the pattern established by `lib/search-params/parsers.ts` for the search page.

**When to use:** Always -- this is the central definition of what the library URL looks like.

**Example:**
```typescript
// lib/library/search-params.ts
import {
  parseAsString,
  parseAsInteger,
  parseAsStringLiteral,
} from "nuqs";

export const librarySortValues = ["savedAt", "rating", "publicationYear"] as const;
export const librarySortOrderValues = ["asc", "desc"] as const;
export const librarySavedPresets = ["week", "month", "year"] as const;
export const libraryViewModes = ["list", "grid"] as const;

export type LibrarySortBy = (typeof librarySortValues)[number];
export type LibrarySortOrder = (typeof librarySortOrderValues)[number];
export type LibrarySavedPreset = (typeof librarySavedPresets)[number];
export type LibraryViewMode = (typeof libraryViewModes)[number];

export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(librarySortValues).withDefault("savedAt"),
  order: parseAsStringLiteral(librarySortOrderValues).withDefault("desc"),
  rating: parseAsInteger,                           // null = no filter
  saved: parseAsStringLiteral(librarySavedPresets),  // null = no date filter
  yf: parseAsInteger,                               // yearFrom, null = no lower bound
  yt: parseAsInteger,                               // yearTo, null = no upper bound
  view: parseAsStringLiteral(libraryViewModes).withDefault("list"),
};
```

### Pattern 2: State Migration (useState to useQueryStates)

**What:** Replace all local `useState` calls in `library-page-client.tsx` with a single `useQueryStates` call backed by the parser map.

**When to use:** This is the core change for FILT-04.

**Current code (Phase 23):**
```typescript
const [searchText, setSearchText] = useState("");
const [sortBy, setSortBy] = useState<SortBy>("savedAt");
const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
const [minRating, setMinRating] = useState<number | undefined>(undefined);
```

**New code (Phase 24):**
```typescript
import { useQueryStates } from "nuqs";
import { librarySearchParams } from "@/lib/library/search-params";

const [params, setParams] = useQueryStates(librarySearchParams);

// Access values:
const searchText = params.q;
const sortBy = params.sort;
const sortOrder = params.order;
const minRating = params.rating ?? undefined;
const savedPreset = params.saved;
const yearFrom = params.yf;
const yearTo = params.yt;
const viewMode = params.view;

// Set values:
setParams({ q: "machine learning" });
setParams({ sort: "rating", order: "desc" });
setParams({ saved: "month" });
```

### Pattern 3: Date Preset to Timestamp Conversion

**What:** Convert URL preset strings ("week", "month", "year") to Unix timestamps for Convex filtering.

**When to use:** In the client component, before passing `savedAfter` to the Convex query.

**Example:**
```typescript
import { subWeeks, subMonths, subYears } from "date-fns";

function savedPresetToTimestamp(preset: string | null): number | undefined {
  if (!preset) return undefined;
  const now = new Date();
  switch (preset) {
    case "week": return subWeeks(now, 1).getTime();
    case "month": return subMonths(now, 1).getTime();
    case "year": return subYears(now, 1).getTime();
    default: return undefined;
  }
}
```

### Pattern 4: Extended Convex Query with Composed Filters

**What:** Add `savedAfter`, `yearFrom`, and `yearTo` args to `browseLibrary` and `searchLibrary` queries. Compose multiple filter predicates using `convex-helpers/server/filter`.

**When to use:** Both browse and search query paths need the same date/year filtering.

**Example:**
```typescript
// convex/library/queries.ts
export const browseLibrary = query({
  args: {
    sortBy: v.union(v.literal("savedAt"), v.literal("rating"), v.literal("publicationYear")),
    sortOrder: v.union(v.literal("asc"), v.literal("desc")),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),   // NEW: timestamp threshold
    yearFrom: v.optional(v.number()),     // NEW: publication year lower bound
    yearTo: v.optional(v.number()),       // NEW: publication year upper bound
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const indexMap = {
      savedAt: "by_user_savedAt",
      rating: "by_user_rating",
      publicationYear: "by_user_year",
    } as const;

    const q = ctx.db
      .query("libraryItems")
      .withIndex(indexMap[args.sortBy], (q) => q.eq("userId", user._id))
      .order(args.sortOrder);

    // Compose filter predicate from all active filters
    const needsFilter = args.minRating !== undefined
      || args.savedAfter !== undefined
      || args.yearFrom !== undefined
      || args.yearTo !== undefined;

    if (needsFilter) {
      return await filter(q, (item) => {
        if (args.minRating !== undefined && item.rating < args.minRating) return false;
        if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) return false;
        if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
        if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});
```

### Pattern 5: View Mode Toggle

**What:** A compact two-button toggle for switching between list and grid views.

**When to use:** Rendered in the library filters bar, alongside sort and filter controls.

**Example:**
```typescript
// Inline in library-filters.tsx or as separate library-view-toggle.tsx
import { LayoutList, LayoutGrid } from "lucide-react";

<div className="flex items-center gap-0.5 p-0.5 bg-muted/50 rounded-lg border border-border/60">
  <button
    onClick={() => setParams({ view: "list" })}
    className={cn(
      "p-1.5 rounded-md transition-colors",
      viewMode === "list"
        ? "text-primary bg-background shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    )}
  >
    <LayoutList className="h-4 w-4" />
  </button>
  <button
    onClick={() => setParams({ view: "grid" })}
    className={cn(
      "p-1.5 rounded-md transition-colors",
      viewMode === "grid"
        ? "text-primary bg-background shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    )}
  >
    <LayoutGrid className="h-4 w-4" />
  </button>
</div>
```

### Anti-Patterns to Avoid

- **Duplicating state between nuqs and useState:** Once nuqs is integrated, ALL filter/sort/search state must come from `useQueryStates`. No shadow `useState` copies. The URL is the single source of truth.
- **Computing timestamps server-side from preset strings:** The Convex query should receive a numeric timestamp, not a string like "week". The client converts presets to timestamps. This keeps the query pure and testable.
- **Using `history: 'push'` for every filter change:** Filter changes should use `history: 'replace'` (nuqs default) so the back button does not step through every filter tweak. Only search text changes might warrant `push` if you want back-button to undo searches.
- **Adding new Convex indexes for date range queries:** The existing `by_user_savedAt` and `by_user_year` indexes use `userId` as the equality prefix. Adding range filters on top would require compound indexes like `["userId", "savedAt", "publicationYear"]` which only help one sort direction. Using `convex-helpers/server/filter` avoids index proliferation and works with the existing index strategy.
- **Storing view mode in both URL and Zustand:** For the library page, FILT-04 requires URL state. Do NOT also persist to Zustand `useUIStore`. The URL is the source of truth for this page. (Other pages like search results may continue using Zustand for their view mode.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL query param parsing/serialization | Manual `URLSearchParams` manipulation | `nuqs` `useQueryStates` + `parseAsStringLiteral`/`parseAsInteger` | nuqs handles type-safe parsing, default values, serialization, history integration, and React state sync. Already proven in the codebase. |
| Date arithmetic (subtract week/month/year) | Manual `Date` math (`date.setMonth(date.getMonth()-1)`) | `date-fns` `subWeeks`, `subMonths`, `subYears` | Month subtraction is notoriously tricky (Jan 31 - 1 month = ?). date-fns handles edge cases correctly. Already installed. |
| Multi-predicate server filter | Nested if/else chains with separate paginate calls | Single `convex-helpers/server/filter` call with composed predicate | One filter call handles all combinations (rating + date + year). Avoids combinatorial explosion of separate query paths. |
| View mode toggle component | Custom toggle from scratch | Adapt existing `ViewModeToggleCompact` pattern from `components/view-mode-toggle.tsx` | Same visual pattern, same icon library, same styling approach. Just reduce from 4 modes to 2. |

**Key insight:** This phase is primarily a state management refactor (useState to nuqs) with two new filter dimensions. The Convex query changes are incremental (adding 3 optional args and composing them into the existing filter predicate). No new indexes, no new tables, no new packages.

## Common Pitfalls

### Pitfall 1: Null vs Undefined in nuqs Parsers

**What goes wrong:** nuqs parsers return `null` for absent URL params, but the existing code uses `undefined` to mean "no filter". Mixing `null` and `undefined` causes TypeScript errors and subtle bugs where `undefined` falls through but `null` does not.

**Why it happens:** JavaScript distinguishes `null` and `undefined`, and nuqs uses `null` to mean "param not in URL" while Convex validators use `v.optional()` which accepts `undefined`.

**How to avoid:** At the boundary between nuqs and Convex query args, convert `null` to `undefined`:
```typescript
const minRating = params.rating ?? undefined;
const savedAfter = savedPresetToTimestamp(params.saved); // returns undefined if null
```

**Warning signs:** TypeScript errors about `null` not assignable to `number | undefined`. Filters that "stick" when they should be cleared.

### Pitfall 2: Stale Timestamp in Date Preset Filter

**What goes wrong:** The `savedAfter` timestamp is computed from `new Date()` at render time. If the user leaves the tab open overnight, "last week" still uses yesterday's computation, and results do not update.

**Why it happens:** `subWeeks(new Date(), 1).getTime()` is computed once and passed as a query arg. Convex reactive queries only re-run when args change, and the timestamp does not change unless the component re-renders.

**How to avoid:** This is acceptable for MVP -- users rarely leave the library page open for hours. If needed later, a periodic refresh (e.g., `useInterval` every 5 minutes to recompute) can be added. Do NOT over-engineer this now.

**Warning signs:** User reports that "last week" filter shows different results after refreshing the page.

### Pitfall 3: Undersized Pages with Multiple Filters

**What goes wrong:** With rating filter AND date filter AND year filter all active, `convex-helpers/server/filter` may return very few items per page (e.g., request 20, get 3 after filtering).

**Why it happens:** Each filter predicate independently reduces the result set. The pagination cursor fetches 20 raw items, then the JS predicate may reject most of them.

**How to avoid:** This is the same tradeoff accepted in Phase 23 for the rating filter. The "Load more" button and `status === "CanLoadMore"` handle this correctly -- the user can keep loading until results are exhausted. For a personal library (typically < 500 items), this is rarely noticeable.

**Warning signs:** User sees "Load more" repeatedly with only 1-2 new items appearing each time.

### Pitfall 4: Search Text Debounce vs URL Updates

**What goes wrong:** If search text is stored in the URL via nuqs, every keystroke updates the URL (and browser history). This creates hundreds of history entries as the user types.

**Why it happens:** `useQueryStates` writes to the URL on every state change by default.

**How to avoid:** Use a local `useState` for the raw search input and debounce before writing to nuqs. The debounced value updates the URL (which triggers the Convex query). This is the same pattern already in place -- `useDebouncedValue` hook exists at `lib/hooks/use-debounced-value.ts`.

```typescript
const [rawSearch, setRawSearch] = useState(params.q);
const debouncedSearch = useDebouncedValue(rawSearch, 300);

// Sync debounced value to URL
useEffect(() => {
  setParams({ q: debouncedSearch });
}, [debouncedSearch]);
```

**Warning signs:** Browser back button steps through every character typed in search.

### Pitfall 5: Year Range with Missing publicationYear

**What goes wrong:** Some library items have `publicationYear: undefined` (it is an optional field). If the year range filter is active, these items should be excluded (they have no year to compare). But if the filter logic uses `item.publicationYear >= yearFrom` without a null check, `undefined >= 2020` evaluates to `false` in JavaScript, which is correct -- but the intent should be explicit.

**Why it happens:** The schema defines `publicationYear: v.optional(v.number())`. Items saved without year data have no `publicationYear` field.

**How to avoid:** Explicitly handle null/undefined in the filter predicate:
```typescript
if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
```

**Warning signs:** Items without publication year silently disappear when year filter is active, confusing users who saved them.

## Code Examples

### Complete Library URL Parsers

```typescript
// lib/library/search-params.ts
import {
  parseAsString,
  parseAsInteger,
  parseAsStringLiteral,
} from "nuqs";

export const librarySortValues = ["savedAt", "rating", "publicationYear"] as const;
export const librarySortOrderValues = ["asc", "desc"] as const;
export const librarySavedPresets = ["week", "month", "year"] as const;
export const libraryViewModes = ["list", "grid"] as const;

export type LibrarySortBy = (typeof librarySortValues)[number];
export type LibrarySortOrder = (typeof librarySortOrderValues)[number];
export type LibrarySavedPreset = (typeof librarySavedPresets)[number];
export type LibraryViewMode = (typeof libraryViewModes)[number];

export const librarySearchParams = {
  q: parseAsString.withDefault(""),
  sort: parseAsStringLiteral(librarySortValues).withDefault("savedAt"),
  order: parseAsStringLiteral(librarySortOrderValues).withDefault("desc"),
  rating: parseAsInteger,
  saved: parseAsStringLiteral(librarySavedPresets),
  yf: parseAsInteger,
  yt: parseAsInteger,
  view: parseAsStringLiteral(libraryViewModes).withDefault("list"),
};
```

### Date Preset Converter

```typescript
// lib/library/search-params.ts (same file or utility)
import { subWeeks, subMonths, subYears } from "date-fns";

export function savedPresetToTimestamp(preset: string | null): number | undefined {
  if (!preset) return undefined;
  const now = new Date();
  switch (preset) {
    case "week": return subWeeks(now, 1).getTime();
    case "month": return subMonths(now, 1).getTime();
    case "year": return subYears(now, 1).getTime();
    default: return undefined;
  }
}
```

### Extended browseLibrary Query

```typescript
// convex/library/queries.ts
import { filter } from "convex-helpers/server/filter";

export const browseLibrary = query({
  args: {
    sortBy: v.union(
      v.literal("savedAt"),
      v.literal("rating"),
      v.literal("publicationYear")
    ),
    sortOrder: v.union(v.literal("asc"), v.literal("desc")),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const indexMap = {
      savedAt: "by_user_savedAt",
      rating: "by_user_rating",
      publicationYear: "by_user_year",
    } as const;

    const q = ctx.db
      .query("libraryItems")
      .withIndex(indexMap[args.sortBy], (q) => q.eq("userId", user._id))
      .order(args.sortOrder);

    const needsFilter =
      args.minRating !== undefined ||
      args.savedAfter !== undefined ||
      args.yearFrom !== undefined ||
      args.yearTo !== undefined;

    if (needsFilter) {
      return await filter(q, (item) => {
        if (args.minRating !== undefined && item.rating < args.minRating) return false;
        if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) return false;
        if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
        if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});
```

### Extended searchLibrary Query

```typescript
export const searchLibrary = query({
  args: {
    searchText: v.string(),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);

    const q = ctx.db
      .query("libraryItems")
      .withSearchIndex("search_library", (sq) =>
        sq.search("searchableText", args.searchText).eq("userId", user._id)
      );

    const needsFilter =
      args.minRating !== undefined ||
      args.savedAfter !== undefined ||
      args.yearFrom !== undefined ||
      args.yearTo !== undefined;

    if (needsFilter) {
      return await filter(q, (item) => {
        if (args.minRating !== undefined && item.rating < args.minRating) return false;
        if (args.savedAfter !== undefined && item.savedAt < args.savedAfter) return false;
        if (args.yearFrom !== undefined && (item.publicationYear == null || item.publicationYear < args.yearFrom)) return false;
        if (args.yearTo !== undefined && (item.publicationYear == null || item.publicationYear > args.yearTo)) return false;
        return true;
      }).paginate(args.paginationOpts);
    }

    return await q.paginate(args.paginationOpts);
  },
});
```

### Client Component State Migration

```typescript
// components/library/library-page-client.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryStates } from "nuqs";
import { librarySearchParams, savedPresetToTimestamp } from "@/lib/library/search-params";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

export function LibraryPageClient() {
  const t = useTranslations("libraryPage");

  // URL state (source of truth)
  const [params, setParams] = useQueryStates(librarySearchParams);

  // Local search input for debounce (don't write every keystroke to URL)
  const [rawSearch, setRawSearch] = useState(params.q);
  const debouncedSearch = useDebouncedValue(rawSearch, 300);

  // Sync debounced search to URL
  useEffect(() => {
    if (debouncedSearch !== params.q) {
      setParams({ q: debouncedSearch });
    }
  }, [debouncedSearch]);

  // Derived values
  const hasSearchText = debouncedSearch.trim().length > 0;
  const savedAfter = savedPresetToTimestamp(params.saved);
  const minRating = params.rating ?? undefined;
  const yearFrom = params.yf ?? undefined;
  const yearTo = params.yt ?? undefined;

  // Query args
  const searchResults = useProtectedPaginatedQuery(
    api.library.queries.searchLibrary,
    hasSearchText
      ? { searchText: debouncedSearch, minRating, savedAfter, yearFrom, yearTo }
      : "skip",
    { initialNumItems: 20 },
  );

  const browseResults = useProtectedPaginatedQuery(
    api.library.queries.browseLibrary,
    !hasSearchText
      ? { sortBy: params.sort, sortOrder: params.order, minRating, savedAfter, yearFrom, yearTo }
      : "skip",
    { initialNumItems: 20 },
  );

  // ... rest of component
}
```

### i18n Keys to Add

```json
{
  "libraryPage": {
    "filterDateSaved": "Date saved",
    "filterLastWeek": "Last week",
    "filterLastMonth": "Last month",
    "filterLastYear": "Last year",
    "filterAllTime": "All time",
    "filterYearRange": "Publication year",
    "filterYearFrom": "From",
    "filterYearTo": "To",
    "viewList": "List view",
    "viewGrid": "Grid view"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Local React state for filters | URL state via nuqs | This phase (24) | Filters become bookmarkable, shareable, and persist across refreshes |
| Single minRating filter | Composed multi-filter (rating + date + year) | This phase (24) | More powerful library browsing with stacking filters |
| List-only view | List + grid view toggle | This phase (24) | Users choose preferred layout |

**Deprecated/outdated:**
- Using `useState` for filter state on the library page: Replaced by `useQueryStates` for URL persistence
- Separate `if` blocks for each filter in Convex queries: Replaced by single composed `filter()` predicate

## Open Questions

1. **Year range input UI component**
   - What we know: The filter needs `yearFrom` and `yearTo` inputs. These could be number inputs, a range slider, or preset buttons.
   - What's unclear: Which UI pattern best fits the compact filter bar.
   - Recommendation: Use two small number `<Input>` fields side by side (From: / To:) with a `type="number"` constraint. This is the simplest approach and matches academic search tools. A range slider would be more visual but harder to use for precise years. Planner's discretion.

2. **Grid view card component design**
   - What we know: FILT-05 requires a grid view. The existing `LibraryItemRow` is designed for list layout. Grid mode needs a card component.
   - What's unclear: Exact card layout -- should it show all metadata or a subset?
   - Recommendation: Create a `LibraryItemCard` component that shows title, authors, year, rating stars, and OA badge in a card layout. Abstract shown on hover or expand. Reuse the same data and action handlers as `LibraryItemRow`. Planner's discretion on exact layout.

3. **URL history mode for search text**
   - What we know: nuqs defaults to `replace` history mode. Filter changes should use `replace`. But search text changes might benefit from `push` so the back button undoes the search.
   - What's unclear: Whether users expect back-button to undo search.
   - Recommendation: Use `replace` for all params (nuqs default). Search is debounced so `push` would create confusing intermediate states. If users want to "go back", they can clear the search field. Planner's discretion.

4. **Initial URL state on first visit**
   - What we know: When a user first visits `/library` with no URL params, `useQueryStates` returns defaults from `withDefault()`. These match the Phase 23 defaults (sort by savedAt desc, no filters).
   - What's unclear: Whether the URL should show `?sort=savedAt&order=desc` explicitly or remain clean (`/library`).
   - Recommendation: Use nuqs `clearOnDefault` behavior (default is true for `useQueryStates`). When all params are at their defaults, the URL stays clean as `/library`. Params only appear when changed. This is the standard nuqs behavior and requires no configuration.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `lib/search-params/parsers.ts` -- Existing nuqs parser map with `parseAsString`, `parseAsInteger`, `parseAsBoolean`, `createParser`, `createSerializer`. Verified pattern for library URL state.
- Codebase analysis: `lib/search/provider.tsx` -- Existing `useQueryStates(searchParamsParsers)` usage with `history: 'push'`. Demonstrates the full nuqs integration pattern.
- Codebase analysis: `convex/library/queries.ts` -- Current browseLibrary and searchLibrary queries with `convex-helpers/server/filter` for rating. Confirmed extensible to additional predicates.
- Codebase analysis: `convex/schema.ts` lines 633-658 -- libraryItems schema with `savedAt: v.number()`, `publicationYear: v.optional(v.number())`, and all indexes.
- Codebase analysis: `components/view-mode-toggle.tsx` -- Existing view mode toggle pattern with lucide icons and `cn()` styling.
- Codebase analysis: `lib/constants/view-modes.ts` -- `GRID_CLASSES` record and `ViewModeOption` interface.
- npm verification: `nuqs` v2.6.0 installed. `parseAsStringLiteral`, `parseAsInteger`, `parseAsString` all confirmed available via Node.js require check.
- npm verification: `date-fns` v4.1.0 installed. `subWeeks`, `subMonths`, `subYears` all confirmed available.
- Codebase analysis: `components/library/library-page-client.tsx` -- Current useState-based implementation. Direct migration target.
- Codebase analysis: `components/library/library-filters.tsx` -- Current filter UI with rating stars and sort dropdown. Extension point for new controls.

### Secondary (MEDIUM confidence)
- Pre-research STACK.md (`.planning/research/STACK.md` lines 370-389) -- Library URL state design with `parseAsStringLiteral` example. Confirmed the planned approach.
- Phase 23 research (`.planning/phases/23-core-library-page/23-RESEARCH.md`) -- Dual-path query strategy and convex-helpers filter pattern. Confirmed extensible.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed, nuqs pattern verified in codebase, date-fns utilities confirmed available
- Architecture: HIGH - URL state migration is straightforward (useState to useQueryStates). Convex query extension is incremental (3 new optional args). View mode toggle follows existing pattern.
- Pitfalls: HIGH - All pitfalls derived from codebase analysis and Phase 23 experience. null/undefined boundary, debounce, undersized pages all verified.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable -- nuqs and Convex APIs are mature, no breaking changes expected)
