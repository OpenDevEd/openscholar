# OpenScholar URL-Based Search State Refactoring

## Overview

This document describes the refactoring work done to transform OpenScholar's search system from localStorage-only state management to a hybrid URL + localStorage approach, enabling shareable search URLs.

## Problem Statement

The original codebase had several issues:
1. **Duplicated types** - Types like `AIProvider`, `SearchField`, `ScreeningQuestion` were defined in multiple files
2. **Monolithic store file** - `lib/store.ts` was 1278 lines with multiple unrelated concerns
3. **Multiple sources of truth** - Search state was scattered across different stores
4. **Non-shareable URLs** - Search state was stored only in localStorage with UUIDs in URLs (e.g., `/results/abc-123`), making searches impossible to share

## Goal

Transform the search system so that **URL query params are the source of truth**, enabling shareable search URLs while maintaining local history with IDs.

**Target URL format:**
```
/results/abc-123?q=machine+learning&field=title&yf=2020&yt=2024
```

**Behavior when sharing:**
- User A shares URL with User B
- User B gets a new local ID but sees the exact same search
- URL params always override stored state if they differ

---

## Completed Work

### Task 1: Consolidated Types

Created `lib/types/` directory with single source of truth for all types.

**Files created:**
- `lib/types/ai.types.ts` - Single `AIProvider` definition (was defined 3x before)
- `lib/types/screening.types.ts` - Unified `ScreeningQuestion`, `ScreeningDocument`, `ScreeningResult`
- `lib/types/search.types.ts` - `SearchField`, `SearchFilters`, `SearchResult`, `SEARCH_FIELDS`
- `lib/types/common.types.ts` - `SearchTerm`, `ReviewStep`, utility functions
- `lib/types/index.ts` - Central re-export

**Files updated to import from centralized types:**
- `lib/store.ts` - Removed duplicate type definitions
- `app/actions/ai-enhance.ts` - Imports `AIProvider` from `lib/types`
- `app/actions/screening.ts` - Imports types from `lib/types`
- `lib/repo.ts` - Imports and re-exports from `lib/types`
- `lib/ai-cost.ts` - Imports from `lib/types`
- `lib/utils.ts` - Imports from `lib/types`

---

### Task 2: Created Search Params Infrastructure

Created `lib/search-params/` directory for URL parameter handling.

**Files created:**

#### `lib/search-params/regions.ts`
Smart continent-aware encoding for geographic filters:
- Encodes `["US", "CA", "MX"]` as `NA` (North America)
- Encodes `["GB", "FR", "DE", ...]` minus UK as `EU-GB`
- Reduces URL length significantly for common region selections

#### `lib/search-params/parsers.ts`
nuqs parsers for all URL parameters with short names:

| Param | Full Name | Type | Default |
|-------|-----------|------|---------|
| `q` | query | string | `''` |
| `field` | search field | string | `'title_and_abstract'` |
| `sort` | sort order | string | `'relevance_score:desc'` |
| `page` | pagination | number | `1` |
| `yf` | year from | number | `null` |
| `yt` | year to | number | `null` |
| `df` | date from | string (ISO) | `null` |
| `dt` | date to | string (ISO) | `null` |
| `ft` | filter type | string | `'year'` |
| `rmin` | rating min | number | `0` |
| `rmax` | rating max | number | `5` |
| `rated` | only rated | boolean | `false` |
| `reg` | regions | string[] | `[]` |
| `focus` | country focus | string[] | `[]` |
| `cites` | cites work ID | string | `''` |
| `citedBy` | cited by work ID | string | `''` |
| `rel` | related to work ID | string | `''` |
| `review` | review articles only | boolean | `false` |
| `lang` | language | string | `null` |

#### `lib/search-params/converters.ts`
Conversion utilities:
- `paramsToSearchResult()` - URL params → SearchResult (for creating history entries)
- `searchResultToParams()` - SearchResult → URL params (for building URLs)
- `paramsToFilters()` - URL params → SearchFilters (for API calls)
- `paramsMatchState()` - Check if URL params match stored state
- `hasActiveFilters()` - Check if any non-default filters are active

#### `lib/search-params/index.ts`
Central exports for the module.

---

### Task 3: Created Hybrid State Hook

Created `lib/hooks/use-search-state.ts` with the main hooks for URL-based state management.

#### `useSearchState()`
Main hook that:
- Uses URL query params as source of truth via nuqs
- Handles reconciliation on mount:
  - Unknown ID + has params → Create new entry with new ID, redirect
  - Known ID + params differ → Update stored state to match URL
  - Known ID + no params → Populate URL from stored state
  - Known ID + matching params → Already in sync
- Provides setters for all filters that update both URL and store
- Includes `getShareableUrl()` and `toSearchFilters()` utilities

#### `useSearchResultsWithParams()`
Combines `useSearchState` with SWR for data fetching:
- Debounces params to avoid API spam while adjusting filters
- Uses URL params directly as SWR cache key
- Auto-updates search history count on success
- Handles errors with toast notifications

---

### Task 5: Updated Results Page

Updated `components/results-page-content.tsx` to use the new URL-based hooks.

**Before:**
```tsx
const { results, isLoading } = useSearchResults();
```

**After:**
```tsx
const { query, results, isLoading, toSearchFilters } = useSearchResultsWithParams();
```

---

### Task 6: Updated Existing Hooks (Backwards Compatibility)

Updated `lib/hooks.ts` to maintain backwards compatibility while using URL-based state internally.

#### `useCurrentSearchFormState()`
- On results pages: Uses `useSearchState()` for URL-based state
- On other pages: Falls back to store-based state
- Returns the same API as before for component compatibility

#### `useUpdateSearchFilter()`
- On results pages: Uses `useSearchState()` setters to update URL params
- On other pages: Returns no-op function with warning
- Existing filter components automatically work with URL params

---

### Task 7: Updated Home Page Navigation

Updated `components/PageContent.tsx` to include URL params when navigating to search results.

**Key changes:**
- Import `serializeSearchParams` from `lib/search-params`
- Build URL params object from search filters
- Navigate with query string: `router.push(`/results/${searchId}?${queryString}`)`

**Updated functions:**
- `handleSubmit()` - New search submission
- `handleSearchHistoryClick()` - Clicking on history items

---

### Task 8: Updated Search Actions

Updated `lib/search-actions.ts`:

- `updateCurrentSearchFilters()` is now a no-op (URL changes trigger SWR refetch automatically)
- `selectQueryFromHistory()` now includes URL params when navigating

---

### Task 9: Added Copy Link Button

Added a share button to `components/navbar.tsx` in the `ResultsActionBar` component.

**Features:**
- Share icon button next to download menu
- Copies shareable URL to clipboard on click
- Shows checkmark icon for 2 seconds after copying
- Toast notification confirms copy

**Implementation:**
```tsx
const { getShareableUrl } = useSearchState();
const [isCopied, setIsCopied] = React.useState(false);

const handleCopyShareLink = async () => {
  const shareableUrl = getShareableUrl();
  await navigator.clipboard.writeText(shareableUrl);
  setIsCopied(true);
  toast.success("Link copied!");
  setTimeout(() => setIsCopied(false), 2000);
};
```

---

### Task 10: Build Fixes and Cleanup

Fixed Suspense boundary issues for nuqs hooks.

**Problem:** nuqs `useQueryStates` requires a Suspense boundary, causing build failures on pages like `/history` and `/results`.

**Solution:**
1. Updated `useCurrentSearchFormState()` to check `pathname?.startsWith('/results')` before using URL-based state
2. Added `useCurrentSearchFormStateFromStore()` fallback for non-results pages
3. Updated `useUpdateSearchFilter()` similarly
4. Wrapped `ResultsLayout` content in `<Suspense>` boundary

---

## File Summary

### New Files Created

```
lib/types/
├── ai.types.ts
├── common.types.ts
├── index.ts
├── screening.types.ts
└── search.types.ts

lib/search-params/
├── converters.ts
├── index.ts
├── parsers.ts
└── regions.ts

lib/hooks/
├── index.ts
└── use-search-state.ts
```

### Files Modified

```
lib/types.ts                        # Re-exports from lib/types/
lib/store.ts                        # Imports from lib/types, removed duplicates
lib/hooks.ts                        # Old hooks now use useSearchState internally
lib/search-actions.ts               # Added URL params to navigation, import converters
lib/utils.ts                        # Imports SEARCH_FIELDS from lib/types
lib/repo.ts                         # Imports from lib/types
lib/ai-cost.ts                      # Imports from lib/types
app/actions/ai-enhance.ts           # Imports AIProvider from lib/types
app/actions/screening.ts            # Imports types from lib/types
app/results/layout.tsx              # Added Suspense boundary
components/results-page-content.tsx # Uses useSearchResultsWithParams
components/PageContent.tsx          # Navigates with URL params
components/navbar.tsx               # Added Share button
```

---

## Architecture Decisions

### 1. URL Params Use Short Names
Compact URLs for shareability:
- `q` instead of `query`
- `yf`/`yt` instead of `yearFrom`/`yearTo`
- `reg` instead of `regions`

### 2. Smart Region Encoding
Reduces URL length for common selections:
- Full Europe: `EU` (not 40+ country codes)
- Europe except UK: `EU-GB`

### 3. History Mode: Push
All filter changes create browser history entries, allowing back/forward navigation.

### 4. Backwards Compatible
Old hooks internally use new hooks. Existing components work without modification.

### 5. Reconciliation on Mount
When opening a shared URL:
1. Check if ID exists in local storage
2. If not, create new entry with new ID
3. Redirect to new ID while preserving all URL params
4. User B has their own history entry with the same search

---

## Testing Checklist

- [ ] Search from home page → URL includes all params
- [ ] Change filter on results page → URL updates
- [ ] Copy shareable link → Valid URL with all params
- [ ] Open shared link in incognito → New ID created, same search displayed
- [ ] Browser back/forward → Filters update correctly
- [ ] Refresh page → State preserved from URL
- [ ] Click history item → Navigates with URL params
- [ ] Build succeeds with no errors

---

## Future Improvements

### Deferred: Split Store File (Task 4)
`lib/store.ts` is still 1278 lines. Could be split into:
- `lib/stores/search-history.ts`
- `lib/stores/ratings.ts`
- `lib/stores/ui.ts`
- `lib/stores/config.ts`

Lower priority since it works correctly.

### Potential Enhancements
1. Add URL validation on mount
2. Add migration for old localStorage format
3. Add "Share" button in more locations (sidebar, paper cards)
4. Add QR code generation for mobile sharing
5. Add shortened URL service integration
