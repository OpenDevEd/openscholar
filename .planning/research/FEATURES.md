# Feature Landscape: Library & Collections (v2.1)

**Domain:** Persistent library with collections for an academic search and extraction tool
**Researched:** 2026-02-28
**Overall confidence:** HIGH (cross-referenced Elicit, Zotero, Semantic Scholar, Mendeley, Paperpile; verified against existing codebase)

---

## Current State Assessment

Before defining what to build, here is what already exists and what the v2.1 milestone changes.

**Existing (client-side only, localStorage via Zustand):**
- `useRatingsStore` persists paper ratings (0-5 stars) keyed by OpenAlex paper ID, in `localStorage` under `paper-ratings-store`
- Rating is a `Record<string, number>` -- paperId to star count
- No server-side persistence of rated items -- ratings vanish on device/browser change
- No saved paper metadata -- only the rating number is stored, not the paper's title, authors, DOI, abstract, etc.
- The "bookmarks" page (`/bookmarks`) is for keyword expansion bookmarks (search query shortcuts), NOT saved papers

**What v2.1 introduces:**
- Server-side library in Convex: rating a paper saves the full paper JSON to the user's library
- Dedicated `/library` page with filtering, sorting, search
- Collection CRUD: create, rename, delete; assign items to multiple collections
- Remove items from library
- Auth-gated: signed-in users only

---

## Table Stakes

Features users expect from any saved-items/library system in an academic tool. Missing these makes the feature feel broken or incomplete.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| **Auto-save on rating** | Rating a paper (existing UX) should persist the full paper entry to the server. Users already rate papers -- the natural expectation is that rated items are saved. Elicit saves every uploaded PDF; Semantic Scholar saves on explicit "Save" click. For this app, rating IS the save action. | LOW | Existing `useRatingsStore`, new `libraryItems` table |
| **Full paper metadata stored** | The saved library item must contain title, authors, DOI, abstract, publication year, journal, OpenAlex ID, cited_by_count, open access status -- everything needed to display and filter without re-fetching OpenAlex. Zotero, Mendeley, and every reference manager stores full metadata. | LOW | OpenAlex `Work` type fields mapped to Convex schema |
| **Dedicated library page** | A single page (`/library`) showing all saved items with header, count, and list. Every reference manager and Elicit have a dedicated library view. | MEDIUM | New route, reuse `CommandCenterContainer` pattern from bookmarks page |
| **Text search within library** | Search by title, author name, or abstract text within saved items. Zotero's Quick Search, Semantic Scholar's library search, and Elicit all provide this. Without it, users with 50+ saved items cannot find anything. | MEDIUM | Convex search index on `libraryItems` table (text search on title or combined field) |
| **Filter by rating** | Filter saved items by star rating (e.g., show only 4-5 star papers). The app already has a rating range picker (`RatingRangePicker` component) -- users expect this to work on saved items too. | LOW | Reuse `RatingRangePicker`, filter on `rating` field in query |
| **Sort options** | Sort by: date saved (recent/oldest), rating (high to low), title (A-Z), publication year. Zotero supports 20+ sort fields; the minimum viable set is 4. | LOW | Convex indexes on `savedAt`, `rating`, `title`, `publicationYear` |
| **Collection CRUD** | Create, rename, delete collections. Every reference manager has folders/collections. Elicit has collections with create/rename/delete. Semantic Scholar has folders. This is table stakes for organization. | MEDIUM | New `collections` table with userId + name |
| **Assign items to multiple collections** | A paper can belong to "Methods Review" AND "COVID-19 Research" simultaneously. Zotero, Elicit, and Semantic Scholar all support multi-collection membership. Single-collection (exclusive folders) is an anti-feature in academic tools. | MEDIUM | Junction table `collectionItems` or array field; junction table is cleaner for Convex querying |
| **Remove items from library** | Users must be able to delete saved items. Elicit: "Delete papers from your library." Removing from a collection should NOT delete the item; removing from library should. | LOW | Delete mutation on `libraryItems`, cascade delete from `collectionItems` |
| **Remove items from a collection (without deleting)** | Removing a paper from a collection keeps it in the library. Elicit explicitly documents: "Removing a paper from a collection doesn't delete the paper." This distinction is critical. | LOW | Delete from `collectionItems` only |
| **Auth-gated access** | Library only available to signed-in users. Unauthenticated users see nothing or a sign-in prompt. Existing auth patterns via Clerk + `assertActiveUser`. | LOW | Existing auth infrastructure, `requireAuth` in Convex queries |
| **"All items" default view** | When navigating to `/library`, show all saved items regardless of collection. Elicit: "All" section shows everything. Collections are filters on top of the full library. | LOW | Default query with no collection filter |
| **Empty state** | When library has no items, show a helpful empty state explaining how to save papers (by rating them). Existing bookmarks page has this pattern with `BookmarksGuide`. | LOW | Reuse `CommandCenterList` empty state pattern |
| **Pagination** | Paginate library items to avoid loading hundreds of papers at once. Existing pattern in bookmarks page uses `CommandCenterPagination`. | LOW | Convex `.paginate()` or client-side pagination (client-side is simpler for MVP, server-side scales better) |
| **Persist rating in library item** | The star rating (0-5) must be stored with the library item so it can be displayed and filtered on the library page without consulting localStorage. | LOW | `rating` field on `libraryItems` table |

---

## Differentiators

Features that set this product apart from basic reference managers. Not expected, but valued.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| **Filter by date saved** | Filter items saved in the last week/month/year. Useful for researchers who want to find recently saved items during an active review period. Zotero has this via smart collections; most simpler tools do not. | LOW | Index on `savedAt`, date range filter |
| **Filter by collection** | In the main library view, filter to show only items in a specific collection. Dropdown or sidebar selector. This is standard in Zotero/Elicit but counts as a differentiator for simpler tools. | LOW | Query with `collectionId` filter |
| **Filter by publication year** | Filter saved papers by their publication year. Researchers often want "papers from last 5 years only." The app already has year range filtering for search -- reuse the pattern. | LOW | Index on `publicationYear`, reuse year range UI |
| **Bulk operations** | Select multiple items and bulk-add to collection, bulk-remove from collection, or bulk-delete. Elicit supports multi-select for tag/collection operations. Important when library grows past ~30 items. | MEDIUM | Multi-select UI state, batch mutations |
| **Collection item count badges** | Show the number of items in each collection next to the collection name in the sidebar/selector. Provides at-a-glance library size awareness. | LOW | Count query per collection, or denormalized `itemCount` field |
| **Export library items** | Download saved items as CSV or JSON. The app already has export infrastructure (`jsonToCSV`, `downloadAsFile`) from the search results page. Extending it to library items is straightforward. | LOW | Reuse existing export utilities |
| **View mode switching** | Toggle between list-simple, list-detail, and grid views. The app already has this pattern via `ViewMode` type and existing command centers. | LOW | Reuse `CommandCenterToolbar` view mode controls |
| **Bridge to extraction** | "Extract data from these saved papers" -- launch extraction workflow directly from selected library items. Elicit does this: "launch a systematic review or data extraction directly from the quick tools menu." This ties library to the existing extraction pipeline. | HIGH | Integration with extraction job creation flow |
| **Sync ratings bidirectionally** | When a user changes a rating on the search results page for a paper already in their library, the library entry's rating should update. When viewing a library item and changing its rating, the search page should reflect this. | MEDIUM | Replace localStorage ratings with server-side ratings for saved items; keep localStorage as fallback for unsaved items |
| **"Unsaved" indicator on search results** | Show a subtle indicator on search result cards when a paper is already in the user's library. Prevents duplicate saves and gives context. | MEDIUM | Client-side lookup against library item IDs (preload user's library OpenAlex IDs) |

---

## Anti-Features

Features to explicitly NOT build. Building these would add complexity without proportional value, or would conflict with the product's focus.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| **Nested/hierarchical collections** | Zotero supports nested collections. "We should too." | Nesting adds significant UI complexity (tree views, drag-drop reordering, breadcrumbs) and data model complexity (parent_id, recursive queries). For a v2.1 MVP, flat collections are sufficient. Elicit uses flat collections. | Flat collections with multi-membership. Users can create "Project A / Methods" as a collection name if they want hierarchy. |
| **Tags (separate from collections)** | Elicit has both tags AND collections. Zotero has both tags AND collections. | Two parallel organizational systems confuse users. Research shows most users use EITHER tags or collections, rarely both effectively. For MVP, collections serve the same purpose. Tags can be added later if demand is clear. | Collections with descriptive names serve as lightweight tags. One organizational axis is enough for v2.1. |
| **Smart collections / saved searches** | Zotero has "Saved Searches" that auto-populate based on criteria. | Smart collections require a query engine that continuously evaluates items against saved predicates. This is a significant backend feature for minimal MVP value. | Manual collection curation. Users add items to collections explicitly. |
| **PDF storage and annotation** | Full reference managers store PDFs and allow highlighting/annotation. | The app is a search and screening tool, not a document reader. PDF storage requires Convex file storage quotas, viewer UI, and annotation persistence -- a major scope expansion. The existing extraction pipeline already handles PDFs for data extraction. | Link to the paper's DOI or OpenAlex URL. Users can use Zotero for PDF management (already integrated via Zotero OAuth). |
| **Citation generation / bibliography export** | Mendeley, Zotero, and EndNote's primary value is citation formatting. | Citation formatting is an entire product category. Building even basic BibTeX export requires handling dozens of citation styles. Users who need citations already use Zotero (which this app integrates with). | Provide "Export to Zotero" or "Copy DOI" instead of trying to replace citation managers. |
| **Collaborative/shared libraries** | Elicit and Semantic Scholar support shared collections/folders. | Multi-user access requires permission models, sharing UI, and conflict resolution. This app's billing model is per-user. Sharing is a v3+ feature at earliest. | Single-user library only. |
| **Import from reference managers** | Elicit supports importing from Zotero. | The app already has Zotero integration for extraction sources. Building a general import flow (BibTeX, RIS, Zotero API) for the library is separate scope. | Papers enter the library by being rated during search. Import can be added later. |
| **Duplicate detection** | Elicit has LLM-powered semantic deduplication. | Duplicate detection is complex (DOI matching is easy; title fuzzy matching and semantic dedup are hard). For v2.1, the natural dedup is that each OpenAlex ID can only appear once in a user's library (unique constraint). | Unique constraint on `(userId, openalexId)`. If a user rates the same paper again, update the existing library entry's rating. |
| **Full paper metadata editing** | Zotero and Mendeley allow editing paper metadata (fix author names, add missing DOIs). | The data comes from OpenAlex. Allowing edits creates a divergence between OpenAlex source data and the user's copy, complicating any future sync. | Show OpenAlex data as read-only. Users can edit ratings and collection assignments, not paper metadata. |

---

## Feature Dependencies

```
[Existing: useRatingsStore (localStorage)]
    |
    v
[Library Items Table] -- rating a paper triggers save to Convex
    |                     (stores full paper metadata + rating + savedAt)
    |
    +---> [/library page] -- shows all saved items
    |         |
    |         +---> [Text search] -- Convex search index on title
    |         +---> [Filter by rating] -- reuse RatingRangePicker
    |         +---> [Filter by collection] -- dropdown/sidebar
    |         +---> [Sort controls] -- date saved, rating, title, year
    |         +---> [Pagination] -- Convex paginate or client-side
    |         +---> [View mode] -- reuse ViewMode pattern
    |         +---> [Empty state] -- reuse CommandCenter pattern
    |
    +---> [Collections Table] -- userId + name + timestamps
    |         |
    |         +---> [Create collection]
    |         +---> [Rename collection]
    |         +---> [Delete collection] -- cascade remove collectionItems
    |
    +---> [Collection Items Table] -- collectionId + libraryItemId
              |
              +---> [Add item to collection(s)]
              +---> [Remove item from collection]

[Existing: Auth via Clerk + assertActiveUser]
    |
    +---> All library/collection mutations and queries are auth-gated
```

### Key Dependency: Rating-to-Save Bridge

The most important architectural decision is how rating connects to saving. Currently:

1. User rates a paper on the search results page (client-side, localStorage)
2. Rating is stored in `useRatingsStore` as `{ [paperId]: number }`

After v2.1:

1. User rates a paper on the search results page
2. If signed in: mutation saves/updates the library item in Convex (full paper JSON + rating)
3. If NOT signed in: fallback to localStorage (existing behavior preserved)
4. `/library` page reads from Convex

This means the rating action becomes a Convex mutation for authenticated users. The `RatingSelector` component needs to call a Convex mutation alongside (or instead of) the Zustand store update.

### Data Flow for Collection Assignment

```
User selects paper(s) in library
    -> Click "Add to collection"
    -> Modal shows existing collections + "Create new"
    -> User selects one or more collections
    -> Mutation inserts rows in collectionItems table
    -> UI reactively updates (Convex real-time)
```

---

## MVP Recommendation

### Phase 1: Core Library (build first)

These features form the minimum viable library. Without all of them, the feature feels incomplete.

1. **`libraryItems` table in Convex** -- store full paper data, rating, savedAt, userId
2. **Auto-save on rating mutation** -- when signed-in user rates a paper, upsert library item
3. **`/library` page with basic list** -- show all saved items, sorted by date saved
4. **Text search** -- Convex search index on title field
5. **Filter by rating** -- reuse existing RatingRangePicker
6. **Sort options** -- date saved, rating, title, publication year
7. **Remove from library** -- delete mutation with confirmation
8. **Auth gate** -- redirect unauthenticated users to sign-in
9. **Empty state** -- "Rate papers to save them to your library"
10. **Pagination** -- Convex `.paginate()` for scalability

### Phase 2: Collections (build second, depends on Phase 1)

Collections require the library to exist first.

1. **`collections` table** -- userId, name, description, timestamps
2. **`collectionItems` junction table** -- collectionId, libraryItemId
3. **Create/rename/delete collection UI**
4. **Add items to collection(s)** -- multi-select + collection picker
5. **Remove items from collection** -- without deleting from library
6. **Filter library by collection** -- dropdown or sidebar filter
7. **Collection item count badges**

### Defer to v2.2+

- Bulk operations (multi-select + bulk actions)
- Export library items
- Bridge to extraction workflow
- Bidirectional rating sync
- "Already saved" indicator on search results
- View mode switching (start with list-detail only)

---

## Complexity Budget

| Feature | Backend (Convex) | Frontend (React) | Total |
|---------|-----------------|------------------|-------|
| libraryItems table + schema | LOW | -- | LOW |
| Auto-save on rating | MEDIUM (upsert logic) | LOW (modify RatingSelector) | MEDIUM |
| /library page + list | LOW (query) | MEDIUM (new page, reuse patterns) | MEDIUM |
| Text search | LOW (search index) | LOW (search input) | LOW |
| Filter by rating | LOW (index filter) | LOW (reuse component) | LOW |
| Sort options | LOW (index) | LOW (dropdown) | LOW |
| Remove from library | LOW (delete mutation) | LOW (button + confirm) | LOW |
| Collections CRUD | MEDIUM (3 mutations) | MEDIUM (modal/form UI) | MEDIUM |
| Collection assignment | MEDIUM (junction table) | MEDIUM (picker modal) | MEDIUM |
| Filter by collection | LOW (query filter) | LOW (dropdown) | LOW |
| **Total** | | | **MEDIUM** |

---

## Convex-Specific Considerations

### Search Index Design

Convex full-text search supports ONE `searchField` per index, with up to 16 `filterFields`. For the library:

```typescript
libraryItems: defineTable({...})
  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["userId", "rating"]
  })
  .index("by_user", ["userId"])
  .index("by_user_rating", ["userId", "rating"])
  .index("by_user_savedAt", ["userId", "savedAt"])
  .index("by_user_openalexId", ["userId", "openalexId"])  // uniqueness check
```

**Limitation:** Convex search queries scan up to 1024 results. For users with very large libraries (1000+ items), text search may not cover all items. This is acceptable for v2.1 -- most users will have < 200 saved items.

### Pagination Strategy

Use Convex `.paginate()` for server-side pagination rather than client-side slicing. This avoids loading all library items into client memory. The existing bookmarks page uses client-side pagination (all bookmarks are in localStorage), but library items are in Convex and should use server-side pagination.

### Real-Time Updates

Convex queries are reactive. When a user rates a paper on the search page, the library page will automatically show the new item without a manual refresh. This is a significant UX advantage over localStorage-based approaches.

---

## Sources

- Direct codebase inspection of existing rating system (`lib/store.ts`, `components/rating-selector.tsx`, `components/bookmarks-command-center/index.tsx`, `convex/schema.ts`) -- HIGH confidence
- [Elicit Library documentation](https://support.elicit.com/en/articles/1499969) -- HIGH confidence
- [Elicit Collections documentation](https://support.elicit.com/en/articles/7928641) -- HIGH confidence
- [Elicit Tags documentation](https://support.elicit.com/en/articles/2171713) -- HIGH confidence
- [Semantic Scholar Library features](https://www.semanticscholar.org/faq) -- MEDIUM confidence
- [Zotero organization guide](https://guides.library.oregonstate.edu/c.php?g=359201&p=2426087) -- HIGH confidence
- [Convex full-text search documentation](https://docs.convex.dev/search/text-search) -- HIGH confidence
- [Convex indexing and query performance](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf) -- HIGH confidence
- [Paperpile: Zotero vs Mendeley comparison](https://paperpile.com/r/zotero-vs-mendeley/) -- MEDIUM confidence
- [Reference manager comparison (Research.com)](https://research.com/software/best-reference-management-software) -- MEDIUM confidence

---
*Feature research for: Library & Collections (v2.1)*
*Researched: 2026-02-28*
