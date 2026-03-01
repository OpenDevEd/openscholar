# Phase 29: Library Export - Research

**Researched:** 2026-03-01
**Domain:** Client-side data export (CSV/JSON) for Convex-backed library
**Confidence:** HIGH

## Summary

Phase 29 adds CSV and JSON export to the library page, closing the EXP-01 requirement from the v2.1 audit. The project already has two well-established export patterns that this phase should reuse: (1) `downloadAsFile` / `jsonToCSV` in `lib/utils.ts` for the search results download flow, and (2) `exportToCSV` / `exportToJSON` in `lib/extraction/export.ts` for the extraction results export dialog. The library export is simpler than both of these because library items have a flat, uniform schema (no questions/answers matrix like extraction, no search metadata like results download).

The key architectural decision is how to get all currently-displayed items for export. The library page uses Convex paginated queries (`useProtectedPaginatedQuery`), which means only loaded pages are available client-side at any moment. There are two viable approaches: (A) export only the currently loaded items (simplest, but user may not have scrolled to load all), or (B) add a new non-paginated Convex query that collects all items matching current filters (decision [23-01] notes that `.collect().length` is acceptable up to 1024 items for `getLibraryCount`, so a full `.collect()` for export is equally viable at this library size). Approach B is recommended because it ensures the export always contains the complete filtered dataset, not just what happened to be loaded via pagination.

**Primary recommendation:** Add a non-paginated `exportLibrary` query to `convex/library/queries.ts` that returns all items matching current filters, then build a lightweight export button/dropdown in the library page header that uses the existing `downloadAsFile` + `jsonToCSV` utilities from `lib/utils.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXP-01 | User can export library items as CSV or JSON (reuse existing export utilities) | Existing `downloadAsFile`, `jsonToCSV` in `lib/utils.ts`; existing `downloadFile` in `lib/extraction/export.ts`. Library schema fields documented. Non-paginated query pattern established via `getLibraryCount`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex | (project version) | Non-paginated query to collect all filtered items | Already used for library queries; `.collect()` pattern used in `getLibraryCount` |
| `lib/utils.ts` | n/a | `downloadAsFile`, `jsonToCSV`, `generateFilename` utilities | Already used by search results download; proven CSV escaping + BOM for Excel |
| next-intl | (project version) | Translation strings for export UI labels | Already used on library page via `useTranslations("libraryPage")` |
| lucide-react | (project version) | `Download` icon for export button | Already used across the project for icon-based buttons |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| sonner (toast) | (project version) | Success/error feedback on export | Already integrated via `toast` import |
| posthog-js | (project version) | Track export events | Already used in `DownloadMenu` component for `results_downloaded` event |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `downloadAsFile` | `file-saver` npm package | Unnecessary dependency; project already has working download utility |
| `ExportDialog` from extraction | Simpler dropdown menu | Extraction dialog has extraction-specific options (confidence, reasoning, citations) that don't apply to library items; a simple dropdown or button pair is sufficient |
| `DownloadMenu` component reuse | New library-specific export | `DownloadMenu` has essential/full distinction that doesn't apply to library; a simpler approach is better |
| xlsx (SheetJS) for Excel export | CSV only + JSON | EXP-01 only requires CSV and JSON; Excel adds complexity and the `xlsx` dependency is only in `lib/extraction/export.ts` |

**Installation:**
```bash
# No new packages needed -- all utilities already exist in the project
```

## Architecture Patterns

### Recommended Project Structure
```
convex/library/
├── queries.ts           # ADD: exportLibrary query (non-paginated)
├── mutations.ts         # No changes
└── collections.ts       # No changes

lib/library/
├── search-params.ts     # No changes
├── trim-paper-data.ts   # No changes
└── export.ts            # NEW: Library-specific export helpers (formatLibraryItemForExport)

components/library/
├── library-page-client.tsx  # ADD: Export button + handler
└── library-filters.tsx      # Possible location for export button (Row 2 sort bar area)
```

### Pattern 1: Non-Paginated Export Query
**What:** A Convex query that returns all library items matching the current filter state, using `.collect()` instead of `.paginate()`.
**When to use:** When the user clicks "Export" and we need the full dataset, not just loaded pages.
**Example:**
```typescript
// convex/library/queries.ts
export const exportLibrary = query({
  args: {
    sortBy: v.union(v.literal("savedAt"), v.literal("rating"), v.literal("publicationYear")),
    sortOrder: v.union(v.literal("asc"), v.literal("desc")),
    minRating: v.optional(v.number()),
    savedAfter: v.optional(v.number()),
    yearFrom: v.optional(v.number()),
    yearTo: v.optional(v.number()),
    collectionId: v.optional(v.id("collections")),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    // Same filter logic as browseLibrary/searchLibrary but with .collect()
    // Returns all matching items (capped at 1024 by Convex default)
  },
});
```

### Pattern 2: Client-Side Export Using Existing Utilities
**What:** Reuse `downloadAsFile` and `jsonToCSV` from `lib/utils.ts` for the actual file generation and download trigger.
**When to use:** For both CSV and JSON export formats.
**Example:**
```typescript
// lib/library/export.ts
import { downloadAsFile, jsonToCSV } from "@/lib/utils";
import type { Doc } from "@/convex/_generated/dataModel";

interface LibraryExportItem {
  title: string;
  authors: string;
  doi: string;
  publicationYear: number | null;
  journal: string;
  rating: number;
  citedByCount: number | null;
  isOpenAccess: boolean;
  oaStatus: string;
  savedAt: string; // ISO date
  abstract: string;
}

export function exportLibraryAsCSV(items: Doc<"libraryItems">[]) {
  const rows = items.map(formatForExport);
  const csv = jsonToCSV(rows);
  downloadAsFile(csv, `library-export-${Date.now()}.csv`, "csv");
}

export function exportLibraryAsJSON(items: Doc<"libraryItems">[]) {
  const data = {
    exportedAt: new Date().toISOString(),
    totalItems: items.length,
    items: items.map(formatForExport),
  };
  downloadAsFile(JSON.stringify(data, null, 2), `library-export-${Date.now()}.json`, "json");
}
```

### Pattern 3: Export Button in Library Header
**What:** Place the export trigger in the library page header alongside the paper count badge, using a `DropdownMenu` for format selection.
**When to use:** UI placement decision -- header is the natural location since export applies to the whole (filtered) library.
**Example:**
```typescript
// In library-page-client.tsx, header section
<div className="flex items-center gap-3 mb-5">
  <h1>...</h1>
  <Badge>...</Badge>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm">
        <Download className="h-4 w-4 mr-2" />
        {t("exportLibrary")}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={handleExportCSV}>
        {t("exportAsCSV")}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={handleExportJSON}>
        {t("exportAsJSON")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```

### Anti-Patterns to Avoid
- **Don't export only loaded paginated results:** Users would get an incomplete export depending on how far they scrolled. Always use the non-paginated query for export.
- **Don't include internal Convex fields in export:** Strip `_id`, `_creationTime`, `userId`, `searchableText` from exported data. These are implementation details, not user-facing data.
- **Don't build a complex export dialog:** Unlike extraction export (which has confidence, reasoning, citations options), library export has a uniform flat schema. A simple dropdown is sufficient.
- **Don't use `xlsx` library for this phase:** EXP-01 only requires CSV and JSON. Adding Excel would be scope creep.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV escaping | Custom CSV string builder | `jsonToCSV` from `lib/utils.ts` | Handles quoting, commas, newlines, BOM for Excel -- all edge cases covered and tested (`tests/export-csv-json.test.ts`) |
| File download trigger | Custom anchor/blob logic | `downloadAsFile` from `lib/utils.ts` | Handles Blob creation, URL.createObjectURL, cleanup, BOM for CSV |
| Date formatting for savedAt | Manual date conversion | `new Date(timestamp).toISOString()` | savedAt is a Unix timestamp; ISO string is universally parseable |

**Key insight:** The project already has battle-tested CSV/JSON export utilities with comprehensive test coverage. Library export should be a thin adapter that maps `Doc<"libraryItems">` fields to a clean export schema and delegates to these utilities.

## Common Pitfalls

### Pitfall 1: Paginated Data Incompleteness
**What goes wrong:** Exporting `displayResults` from the paginated query only gives the user whatever pages they've loaded, which could be 20 items out of 500.
**Why it happens:** Library page uses `useProtectedPaginatedQuery` with `initialNumItems: 20` and "Load more" pagination.
**How to avoid:** Create a dedicated non-paginated export query that uses `.collect()` to get all matching items.
**Warning signs:** Export file has exactly 20 (or a multiple of 20) items when the library has more.

### Pitfall 2: Convex `.collect()` 1024-Item Limit
**What goes wrong:** Convex `.collect()` returns at most 1024 documents by default.
**Why it happens:** Convex enforces this limit to prevent unbounded queries.
**How to avoid:** For v2.1, this is acceptable per decision [23-01] ("acceptable for libraries up to 1024 items"). If needed later, use cursor-based batching. Document the limitation.
**Warning signs:** User has 1000+ items and export is truncated.

### Pitfall 3: Including Internal Fields in Export
**What goes wrong:** Exported CSV/JSON contains `_id`, `_creationTime`, `userId`, `searchableText` which are meaningless to users and expose implementation details.
**Why it happens:** Directly serializing the Convex document without field selection.
**How to avoid:** Map each item through a `formatForExport` function that selects only user-facing fields.
**Warning signs:** Export columns include `_id` or `searchableText`.

### Pitfall 4: CSV Authors Field Handling
**What goes wrong:** The `authors` field in `libraryItems` is already a flattened string ("John Doe, Jane Smith"), which may be misinterpreted as multiple CSV columns.
**Why it happens:** CSV splitting on commas without proper quoting.
**How to avoid:** The existing `jsonToCSV` function in `lib/utils.ts` already handles this via `escapeCSVValue` which wraps comma-containing values in quotes.
**Warning signs:** Author names split across multiple columns in Excel.

### Pitfall 5: Export Button Visible When Library Is Empty
**What goes wrong:** Export button appears even when the library is empty, leading to empty file downloads.
**Why it happens:** Not gating export button visibility on item count.
**How to avoid:** Only show the export button when `totalCount > 0`. Also disable it when filters produce zero results.
**Warning signs:** User can export an empty CSV (headers only) or empty JSON.

## Code Examples

### Library Item Schema Fields (for export mapping)
```typescript
// From convex/schema.ts - libraryItems table
// These are the fields stored for each library item:
{
  userId: Id<"users">,      // EXCLUDE from export
  openalexId: string,       // INCLUDE - useful for linking back
  rating: number,           // INCLUDE
  title: string,            // INCLUDE
  authors: string?,         // INCLUDE (already flattened)
  doi: string?,             // INCLUDE
  abstract: string?,        // INCLUDE
  publicationYear: number?, // INCLUDE
  journal: string?,         // INCLUDE
  citedByCount: number?,    // INCLUDE
  isOpenAccess: boolean?,   // INCLUDE
  oaStatus: string?,        // INCLUDE
  searchableText: string,   // EXCLUDE (internal)
  savedAt: number,          // INCLUDE (convert to ISO date)
  updatedAt: number,        // INCLUDE (convert to ISO date)
}
```

### Existing downloadAsFile Utility
```typescript
// Source: lib/utils.ts (lines 167-185)
export function downloadAsFile(content: string, filename: string, type: 'json' | 'csv') {
  const mimeTypes = { json: 'application/json', csv: 'text/csv' };
  const bom = type === 'csv' ? '\ufeff' : '';
  const blob = new Blob([bom + content], { type: mimeTypes[type] });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
```

### Existing jsonToCSV Utility
```typescript
// Source: lib/utils.ts (lines 142-165)
// Handles: header extraction, CSV escaping (quotes, commas, newlines), sorted headers
// Tests: tests/export-csv-json.test.ts (13 test cases covering edge cases)
```

### Translation Keys Pattern
```typescript
// Source: messages/en-US.json, libraryPage namespace
// Add new keys following existing naming convention:
{
  "exportLibrary": "Export",
  "exportAsCSV": "Download as CSV",
  "exportAsJSON": "Download as JSON",
  "exportSuccess": "Library exported successfully",
  "exportEmpty": "No items to export"
}
```

### Export Query Filter Reuse
```typescript
// The export query should replicate the exact filter logic from browseLibrary/searchLibrary
// to ensure "export respects current filters" requirement.
// Key filter fields from URL params (lib/library/search-params.ts):
// - q (search text) -> searchText
// - rating -> minRating
// - saved -> savedAfter (via savedPresetToTimestamp)
// - yf/yt -> yearFrom/yearTo
// - col -> collectionId
// - sort/order -> sortBy/sortOrder
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Using `lib/extraction/export.ts` for all exports | Domain-specific export modules | Extraction has its own, search results use `lib/utils.ts` | Library should use `lib/utils.ts` pattern, not extraction pattern |
| Client-side data collection from paginated views | Server query for full dataset | Standard pattern | Export query must be non-paginated to get all items |

**Deprecated/outdated:**
- None applicable; all existing export utilities are current.

## Open Questions

1. **Search mode export behavior**
   - What we know: In search mode, results are ordered by Convex searchIndex relevance. The export query with `searchText` should use the same searchIndex path.
   - What's unclear: Should the export maintain search relevance ordering? Or default to savedAt?
   - Recommendation: Preserve the same query mode -- if user is in search mode, export uses searchIndex; if in browse mode, export uses the sort index. This matches "export respects current filters."

2. **Convex query vs. action for export**
   - What we know: Queries are reactive and read-only. Actions can do more but are not reactive.
   - What's unclear: Whether a query with `.collect()` is the best fit vs. an action.
   - Recommendation: Use a query. The data is read-only, fits within the 1024-item limit per decision [23-01], and queries are simpler. An action would be needed only if we exceeded the limit and needed cursor-based batching.

## Sources

### Primary (HIGH confidence)
- `convex/schema.ts` - libraryItems table definition (lines 633-658)
- `convex/library/queries.ts` - Existing paginated query patterns and filter logic
- `lib/utils.ts` - `downloadAsFile`, `jsonToCSV`, `generateFilename` utilities (lines 142-218)
- `lib/extraction/export.ts` - Existing extraction export pattern (for comparison, not reuse)
- `components/extraction/export-dialog.tsx` - Existing export dialog pattern (for comparison)
- `components/download-menu.tsx` - Existing download dropdown pattern
- `components/library/library-page-client.tsx` - Library page component structure
- `tests/export-csv-json.test.ts` - Test coverage for CSV/JSON utilities

### Secondary (MEDIUM confidence)
- `messages/en-US.json` - Translation key naming conventions (libraryPage namespace)
- `lib/library/search-params.ts` - URL param parsers for filter state
- Decision [23-01] from STATE.md - `.collect().length` acceptable for up to 1024 items

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All utilities already exist and are tested in the project
- Architecture: HIGH - Clear patterns from extraction export and search download; library export is simpler than both
- Pitfalls: HIGH - Well-understood edge cases; pagination/collect limit is documented in project decisions

**Research date:** 2026-03-01
**Valid until:** 2026-03-31 (stable domain, no external API dependencies)
