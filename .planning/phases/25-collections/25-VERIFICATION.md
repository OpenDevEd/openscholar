---
phase: 25-collections
verified: 2026-03-01T05:42:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
human_verification:
  - test: "End-to-end collection workflow"
    expected: "Create collection, assign items, filter by collection, rename, delete — all work visually and persist in URL"
    why_human: "UI correctness, dialog interaction flows, and toast feedback cannot be verified programmatically"
---

# Phase 25: Collections Verification Report

**Phase Goal:** Implement collections feature for organizing library items — schema, CRUD, assignment, filtering, UI components, and i18n
**Verified:** 2026-03-01T05:42:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

All truths verified across all three plans (25-01, 25-02, 25-03).

#### Plan 01 Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can create a collection with a name and it persists in the database | VERIFIED | `createCollection` mutation in `convex/library/collections.ts` lines 10-26: validates non-empty name, inserts into `collections` table with userId, name, createdAt, updatedAt |
| 2 | User can rename an existing collection they own | VERIFIED | `renameCollection` mutation lines 28-50: fetches collection, checks NOT_FOUND and FORBIDDEN, patches name and updatedAt |
| 3 | User can delete a collection and all its junction rows are cascade-deleted without deleting library items | VERIFIED | `deleteCollection` mutation lines 52-75: queries `libraryItemCollections` by `by_collection` index, deletes each membership, then deletes the collection |
| 4 | Collections use a junction table (libraryItemCollections) for many-to-many, not array fields | VERIFIED | `convex/schema.ts` lines 674-683: `libraryItemCollections` table with 4 indexes; `libraryItems` table (lines 633-658) has no collection array field |
| 5 | Removing a library item cascade-deletes its junction rows | VERIFIED | `convex/library/mutations.ts`: both `removeFromLibraryByOpenalexId` (lines 72-79) and `removeFromLibrary` (lines 102-109) query `by_item` index and delete all junction rows before deleting the item |

#### Plan 02 Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | User can assign a library item to one or more collections | VERIFIED | `addToCollection` mutation lines 93-133: verifies collection and item ownership, checks idempotency via `by_collection_item` index, inserts junction row |
| 7 | User can remove an item from a collection without deleting it from the library | VERIFIED | `removeFromCollection` mutation lines 136-166: verifies collection ownership, deletes junction row if found; library item is untouched |
| 8 | Each collection displays an item count badge (via getCollectionsWithCounts query) | VERIFIED | `getCollectionsWithCounts` query lines 172-201: counts `libraryItemCollections` rows per collection via `by_collection` index, returns `{ ...collection, itemCount }` sorted alphabetically |
| 9 | User can filter library items by collection in both browse and search modes | VERIFIED | `browseLibrary` and `searchLibrary` in `convex/library/queries.ts` both accept `collectionId: v.optional(v.id("collections"))` (lines 19, 92) and pre-fetch junction rows into a Set for filtering |
| 10 | Duplicate assignment is silently idempotent (no error, no duplicate row) | VERIFIED | `addToCollection` lines 115-124: queries `by_collection_item` compound index with `.unique()`, returns null immediately if existing row found |
| 11 | Collection filter URL param 'col' is defined in librarySearchParams | VERIFIED | `lib/library/search-params.ts` line 51: `col: parseAsString, // Collection ID filter (null = all collections)` |

#### Plan 03 Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 12 | User can see a collection filter dropdown in the library filters with item count badges | VERIFIED | `library-filters.tsx` lines 274-308: 4th FilterSection with FolderOpen icon, Select with `collections?.map()` rendering badges per item count |
| 13 | User can create a new collection from the library page | VERIFIED | `collection-manager.tsx` lines 69-79: `handleCreate` calls `createCollection` mutation, shows `toast.success(t("collectionCreated"))`, resets to list mode. Wired in `library-page-client.tsx` line 293-296 |
| 14 | User can rename and delete collections from a management UI | VERIFIED | `collection-manager.tsx` lines 81-110: `handleRename` and `handleDelete` (with `showConfirmation` destructive dialog). `renameCollection` and `deleteCollection` mutations called |
| 15 | User can assign a library item to collections via dropdown menu in both list and grid views | VERIFIED | `library-item-row.tsx` line 144-151: `onAddToCollection(item)` in DropdownMenuItem. `library-item-card.tsx` line 86-88: same. Wired in `library-page-client.tsx` lines 252-253, 264 |
| 16 | User can remove an item from a collection via the collection picker | VERIFIED | `collection-picker.tsx` lines 50-65: `handleToggle` calls `removeFromCollection` when `isCurrentlyChecked` is true |
| 17 | Filtering by collection updates the URL with col param and filters the item list | VERIFIED | `library-page-client.tsx` line 64: `collectionId = params.col ?? undefined`. Lines 86-94: `collectionId` passed to both `searchLibrary` and `browseLibrary`. Line 219: `onCollectionChange={(id) => setParams({ col: id })}` |
| 18 | All collection UI strings are translated in 6 locales | VERIFIED | All 6 locale files (en-US, en-GB, fr, zh, ja, hi) each contain all 4 spot-checked keys: `filterCollection`, `addToCollection`, `collectionCreated`, `manageCollections` |

**Score:** 18/18 individual truths verified (spanning all three plan must-haves)

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/schema.ts` | collections and libraryItemCollections table definitions with indexes | VERIFIED | Lines 662-683: both tables present with correct fields and all 5 required indexes (by_user, by_collection, by_item, by_collection_item, by_user on junction) |
| `convex/library/collections.ts` | Collection CRUD mutations and listCollections query | VERIFIED | All 4 exports present: `createCollection`, `renameCollection`, `deleteCollection`, `listCollections`. 217 lines, substantive implementation with auth guards, error handling, and index usage |
| `convex/library/mutations.ts` | Extended removeFromLibrary and removeFromLibraryByOpenalexId with junction cascade | VERIFIED | Both mutations query `libraryItemCollections` by `by_item` index and delete all rows before deleting the item |
| `convex/library/collections.test.ts` | TDD test suite for collection CRUD and cascade behavior | VERIFIED | 33 tests — all passing (`npx vitest run` confirmed: "33 passed") |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/library/collections.ts` | addToCollection, removeFromCollection, getCollectionsWithCounts, getItemCollections | VERIFIED | All 4 additional exports present at lines 93, 136, 172, 204. Each has full auth, ownership validation, and correct index usage |
| `convex/library/queries.ts` | Extended browseLibrary and searchLibrary with optional collectionId filter | VERIFIED | Both queries accept `collectionId: v.optional(v.id("collections"))` and implement Set-based pre-fetch filtering with ownership guard (empty-result on unowned collection) |
| `lib/library/search-params.ts` | col param added to librarySearchParams | VERIFIED | Line 51: `col: parseAsString` present in the exported `librarySearchParams` object |
| `convex/library/collections.test.ts` | Tests for assignment, removal, counts, and collection-filtered queries | VERIFIED | 33 total tests confirmed passing; Plan 02 tests cover addToCollection, removeFromCollection, getCollectionsWithCounts, getItemCollections, browseLibrary+searchLibrary with collectionId |

#### Plan 03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `components/library/collection-manager.tsx` | Dialog for creating, renaming, and deleting collections | VERIFIED | 279 lines. Exports `CollectionManager`. Three modes: list, create, rename. Uses `useProtectedQuery` for `getCollectionsWithCounts`, `useMutation` for CRUD, `showConfirmation` for delete, `toast.success` for feedback |
| `components/library/collection-picker.tsx` | Multi-select dialog for assigning items to collections | VERIFIED | 116 lines. Exports `CollectionPicker`. Fetches collections and item memberships via `useProtectedQuery`. Checkbox toggles fire `addToCollection`/`removeFromCollection` fire-and-forget |
| `components/library/library-filters.tsx` | Extended with collection filter section | VERIFIED | Props interface extended with `collectionId`, `onCollectionChange`, `collections`, `onManageCollections`. 4-column grid (line 142). Collection FilterSection with Select + badge rendering + "Manage collections" button |
| `components/library/library-page-client.tsx` | Extended with collection state, filter, and management wiring | VERIFIED | Collection state (`collectionManagerOpen`, `collectionPickerItemId`), `collectionsWithCounts` query, `collectionId` derived from URL, both query hooks pass `collectionId`, `clearFilters` includes `col: null`, both dialogs rendered at bottom |
| `messages/en-US.json` | English i18n keys for all collection UI strings | VERIFIED | Contains `filterCollection`, `allCollections`, `manageCollections`, `createCollection`, `createCollectionDescription`, `collectionNamePlaceholder`, `createButton`, `renameCollection`, `deleteCollection`, `deleteCollectionConfirmTitle`, `deleteCollectionConfirmMessage`, `addToCollection`, `removeFromCollection`, `noCollections`, `collectionCreated`, `collectionRenamed`, `collectionDeleted`, `addedToCollection`, `removedFromCollection`, `collectionItemCount`, `saveButton`, `manageCollectionsTitle` |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/library/collections.ts` | `convex/schema.ts` | `ctx.db.insert("collections"` | VERIFIED | Line 19: `ctx.db.insert("collections", {...})` confirmed |
| `convex/library/mutations.ts` | `convex/schema.ts` | `libraryItemCollections` cascade delete | VERIFIED | Lines 73-79 and 102-108: both mutations query `libraryItemCollections` by `by_item` index |

#### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/library/collections.ts` | `convex/library/queries.ts` | Both use `libraryItemCollections` junction table | VERIFIED | collections.ts uses `by_collection`, `by_item`, `by_collection_item` indexes; queries.ts uses `by_collection` for pre-fetch |
| `convex/library/queries.ts` | `convex/schema.ts` | `collectionId` arg in browseLibrary/searchLibrary | VERIFIED | Line 19 and 92: `collectionId: v.optional(v.id("collections"))` in both queries' args |
| `lib/library/search-params.ts` | `components/library/library-page-client.tsx` | `col` param consumed for collection filter | VERIFIED | `library-page-client.tsx` line 64: `const collectionId = params.col ?? undefined`; lines 86-94 pass it to both query hooks |

#### Plan 03 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `components/library/library-page-client.tsx` | `convex/library/collections.ts` | `useProtectedQuery` for getCollectionsWithCounts, useMutation for CRUD | VERIFIED | Lines 58-61: `useProtectedQuery(api.library.collections.getCollectionsWithCounts, {})`. CollectionManager and CollectionPicker each use mutations internally |
| `components/library/library-filters.tsx` | `components/library/library-page-client.tsx` | collection filter props passed down | VERIFIED | `library-page-client.tsx` lines 218-221: all 4 new props passed. `library-filters.tsx` lines 55-58: all 4 in interface |
| `components/library/collection-picker.tsx` | `convex/library/collections.ts` | addToCollection and removeFromCollection mutations | VERIFIED | `collection-picker.tsx` lines 43-46: `useMutation(api.library.collections.addToCollection)` and `useMutation(api.library.collections.removeFromCollection)` |
| `components/library/library-page-client.tsx` | `convex/library/queries.ts` | collectionId arg passed to browseLibrary and searchLibrary | VERIFIED | Lines 86-94: `collectionId: collectionId as Id<"collections"> | undefined` in both query calls |

---

### Requirements Coverage

All requirement IDs from all three plan frontmatter fields, cross-referenced against REQUIREMENTS.md:

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| COL-01 | 25-01, 25-03 | User can create a new collection with a name | SATISFIED | `createCollection` mutation + CollectionManager create mode |
| COL-02 | 25-01, 25-03 | User can rename an existing collection | SATISFIED | `renameCollection` mutation + CollectionManager rename mode |
| COL-03 | 25-01, 25-03 | User can delete a collection (cascade deletes junction rows, does not delete library items) | SATISFIED | `deleteCollection` cascade + test verifies library items untouched |
| COL-04 | 25-02, 25-03 | User can assign a library item to one or more collections | SATISFIED | `addToCollection` mutation + CollectionPicker checkbox UI |
| COL-05 | 25-02, 25-03 | User can remove an item from a collection without deleting it from the library | SATISFIED | `removeFromCollection` mutation + CollectionPicker toggle |
| COL-06 | 25-01, 25-03 | Collections use a junction table (libraryItemCollections) for many-to-many, not array fields | SATISFIED | `libraryItemCollections` table in schema; `libraryItems` has no array field for collections |
| COL-07 | 25-02, 25-03 | Each collection displays an item count badge | SATISFIED | `getCollectionsWithCounts` returns `itemCount`; rendered as `<Badge>` in LibraryFilters and CollectionManager |
| FILT-03 | 25-02, 25-03 | User can filter library items by collection | SATISFIED | `browseLibrary` and `searchLibrary` accept `collectionId`; `col` URL param wired via `setParams` |

**All 8 requirements satisfied. No orphaned requirements found.**

REQUIREMENTS.md confirms all COL-01 through COL-07 and FILT-03 are mapped to Phase 25 and marked Complete.

---

### Anti-Patterns Found

Scanned: `convex/library/collections.ts`, `convex/library/queries.ts`, `convex/library/mutations.ts`, `components/library/collection-manager.tsx`, `components/library/collection-picker.tsx`, `components/library/library-filters.tsx`, `components/library/library-page-client.tsx`

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

All `placeholder` occurrences are valid HTML input `placeholder` attributes (not code stubs). No TODO/FIXME comments, no empty implementations, no `return null` stubs, no console.log-only handlers found in phase files.

---

### Human Verification Required

#### 1. End-to-end Collection Workflow

**Test:** Navigate to `/library` (signed in with papers in library). Create a collection via "Manage collections" link in the filter bar. Assign an item via the three-dot menu "Add to collection". Filter by the collection. Verify URL has `?col=...`. Remove item from collection via collection picker checkbox. Rename and delete the collection.

**Expected:** All operations work, toasts appear, URL state persists, library items survive collection deletion.

**Why human:** Dialog interactions, toast rendering, URL parameter encoding, and visual feedback cannot be verified programmatically.

#### 2. Grid View Collection Assignment

**Test:** Switch to grid view. Click the three-dot menu on a card. Verify "Add to collection" appears and opens the picker dialog.

**Expected:** Collection picker dialog opens from grid card menu. Toggle works.

**Why human:** Visual layout and interaction flow in grid mode.

#### 3. Search + Collection Filter Combination

**Test:** Type a search query while a collection filter is active. Verify results are filtered by both search text AND collection membership.

**Expected:** Only items matching both the search text and the collection appear.

**Why human:** Real query behavior with actual data in the database.

---

### Gaps Summary

No gaps. All 18 truths verified, all 12 planned artifacts exist and are substantive, all 8 key links wired, all 8 requirements satisfied. 33 tests pass.

---

_Verified: 2026-03-01T05:42:00Z_
_Verifier: Claude (gsd-verifier)_
