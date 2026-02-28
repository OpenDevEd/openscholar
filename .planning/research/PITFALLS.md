# Pitfalls Research

**Domain:** Adding library, collections, and saved-items features to an existing Next.js + Convex academic search app
**Researched:** 2026-02-28
**Confidence:** HIGH (verified against Convex official docs, codebase analysis, Convex community patterns)

---

## Critical Pitfalls

### Pitfall 1: Storing Full OpenAlex JSON Blobs Causes Document Bloat and Bandwidth Explosion

**What goes wrong:**
The v2.1 spec says "rating an item saves it to user's library (full JSON entry in Convex)." An OpenAlex `Work` object is a deeply nested JSON structure containing `authorships[]` (each with `author`, `institutions[]`, `countries[]`), `concepts[]`, `topics[]`, `primary_location` with nested `source`, `biblio`, `open_access`, `apc_list`, `grants[]`, `referenced_works[]` (often 30-100 IDs), `related_works[]` (10 IDs), `abstract_inverted_index` (can be 2-5 KB alone), and more. A single Work can be 5-30 KB of JSON. Storing the full object as-is in a Convex document means:

1. **Document size risk:** Convex has a 1 MiB document limit with max 1024 fields and max nesting depth of 16. The `abstract_inverted_index` alone is a deeply nested object with hundreds of keys, and `authorships` arrays can have 50+ entries each containing nested objects. A paper with 200+ authors (common in physics/medicine) could approach field limits.
2. **Bandwidth cost:** Every time the library page loads, ALL stored fields are transferred to the client. With Convex's reactive queries, every update to any library item re-sends the full document. At 20 KB per item and 500 items in a library, that is 10 MB per page load. Convex charges $0.20-0.22/GiB for database bandwidth beyond the included tier.
3. **Array element limit:** Convex arrays are capped at 8192 elements. A paper's `referenced_works` can have hundreds of entries, and `abstract_inverted_index` values are arrays of positions. These won't hit the limit individually but accumulate risk if the schema stores everything.

**Why it happens:**
The requirement says "full JSON" which developers interpret as storing the entire OpenAlex API response verbatim. This feels safe because "we might need it later" and avoids deciding which fields matter upfront. The `PaperResult` type in `lib/types/search.types.ts` is literally `type PaperResult = Work` -- the entire SDK type with no field selection.

**How to avoid:**
- Define a `LibraryItem` schema in Convex that stores only the fields needed for display and filtering: `openalexId`, `title`, `authors` (names only, not full authorship objects), `publicationYear`, `doi`, `abstract` (reconstructed text, not inverted index), `citationCount`, `isOpenAccess`, `primarySourceName`, `type`. This covers all display and filter needs.
- Store the `openalexId` (e.g., `W2741809807`) as the canonical reference. If the user needs full details, fetch fresh from OpenAlex API on demand -- it is free, fast, and always current.
- Drop `abstract_inverted_index`, `referenced_works`, `related_works`, `grants`, `apc_list`, `biblio`, `mesh`, `sustainable_development_goals`, `keywords`, and the full `authorships` nesting. These are never displayed in a library list view.
- Target 1-2 KB per library item document instead of 15-30 KB.

**Warning signs:**
- Library page load time exceeds 500ms for users with 100+ items
- Convex dashboard shows database bandwidth spiking when library page is open
- Schema validation errors on documents with deeply nested authorship arrays
- `v.any()` used in schema for the library item data field (defers validation, hides bloat)

**Phase to address:** Phase 1 (Schema design) -- define the normalized `libraryItems` schema before any mutation code is written. This is irreversible without a data migration if done wrong.

---

### Pitfall 2: Many-to-Many Collection Membership Without a Junction Table

**What goes wrong:**
Items can belong to multiple collections. There are two ways to model this, and choosing wrong creates cascading problems:

**Bad approach A -- Array of collection IDs on the library item:**
```typescript
libraryItems: defineTable({
  userId: v.id("users"),
  collectionIds: v.array(v.id("collections")),  // BAD
  // ...
})
```
This fails because: (a) Convex arrays cannot be indexed -- you cannot query "all items in collection X" without scanning every library item for the user, (b) removing a collection requires scanning ALL items to remove the reference, (c) Convex arrays are limited to 8192 elements (not a real risk here but the pattern is wrong), (d) adding/removing collection membership mutates the library item document, triggering reactive re-renders of unrelated UI.

**Bad approach B -- Array of item IDs on the collection:**
```typescript
collections: defineTable({
  userId: v.id("users"),
  name: v.string(),
  itemIds: v.array(v.id("libraryItems")),  // BAD
  // ...
})
```
Same indexing problem in reverse -- cannot efficiently query "which collections contain item X?" Also, the collection document grows unboundedly as items are added.

**Why it happens:**
Arrays feel simpler than a junction table. Developers think "this is a NoSQL database, just embed it." The Convex docs explicitly recommend relationship tables for many-to-many but developers skip that page.

**How to avoid:**
Use a dedicated junction table with dual indexes:
```typescript
collectionItems: defineTable({
  collectionId: v.id("collections"),
  libraryItemId: v.id("libraryItems"),
  addedAt: v.number(),
})
  .index("by_collection", ["collectionId"])
  .index("by_item", ["libraryItemId"])
  .index("by_collection_item", ["collectionId", "libraryItemId"])
```
The composite index `by_collection_item` enables O(1) existence checks ("is this item in this collection?") via `.withIndex("by_collection_item", q => q.eq("collectionId", x).eq("libraryItemId", y)).unique()`.

**Warning signs:**
- Schema uses `v.array(v.id(...))` for collection membership
- Queries use `.filter()` with `.includes()` to check collection membership instead of index lookups
- Collection deletion requires loading all library items to remove references

**Phase to address:** Phase 1 (Schema design) -- the junction table must exist from the start. Migrating from embedded arrays to a junction table after data exists requires a full data migration.

---

### Pitfall 3: Pagination with Client-Side Filters Produces Empty or Undersized Pages

**What goes wrong:**
The library page needs filtering by rating, collection, date saved, text search, and sort. If pagination is done at the Convex query level using `.paginate()` and then filters are applied in TypeScript (either server-side in the query function or client-side), pages will be undersized or empty. Example: user requests page of 20 items, Convex returns 20, TypeScript filter for "rating >= 4" keeps only 3. The user sees a page with 3 items and must click "load more" repeatedly.

This is a documented Convex limitation: "filtering in code afterwards can result in a smaller page or even an empty page" and "can slow down load times and cost database bandwidth as it traverses the entire table across many pages."

**Why it happens:**
Convex's `.paginate()` operates on the database cursor level. It returns N documents from the index, then your code filters them. The cursor has already advanced past the filtered-out documents. You cannot "back-fill" the page to reach the requested size without issuing another paginate call, which creates a different cursor chain.

The existing codebase already does client-side pagination for search results (see `results-list.tsx` using `ITEMS_PER_PAGE` with in-memory slicing of `filteredResults`), which works because ALL search results are fetched from OpenAlex at once. But library items live in Convex and could number in the thousands -- loading all items and filtering client-side won't scale.

**How to avoid:**
- **Use indexes for every filterable dimension.** Rating filter: index `by_user_rating` on `["userId", "rating"]`. Date filter: index `by_user_savedAt` on `["userId", "savedAt"]`. Collection filter: query the `collectionItems` junction table by collection, then batch-fetch the items.
- **Use the `filter` helper from `convex-helpers`** for conditions that cannot be expressed as indexes (e.g., text search on title). This helper integrates with `.paginate()` and handles the undersized-page problem by continuing to scan until the requested page size is filled.
- **For collection-filtered pagination:** Do NOT paginate `libraryItems` and then check collection membership. Instead, paginate `collectionItems` by collection index, then batch-fetch the library items for each page. This inverts the query direction and ensures full pages.
- **For text search:** Use Convex's `.withSearchIndex()` which supports pagination natively. Define a search index on the `title` field (and optionally `abstract`).

**Warning signs:**
- Users report "Load More" button needed 5+ times to see results when filters are active
- Library page shows 2-3 items when 50 match the filter
- Query function uses `.paginate()` followed by `.filter()` or array `.filter()` on the result

**Phase to address:** Phase 2 (Library queries) -- design filter-aware pagination from the start. Retrofitting pagination strategy after the queries are written and the UI depends on the cursor format requires rewriting both backend and frontend.

---

### Pitfall 4: Collection Deletion Without Cascade Leaves Orphaned Junction Records

**What goes wrong:**
User deletes a collection. The mutation deletes the `collections` document but forgets to delete the corresponding `collectionItems` junction records. Now `collectionItems` rows reference a non-existent collection ID. Symptoms:
1. "Ghost" items appear when querying junction table by item (the item appears to belong to a deleted collection)
2. Item count badges show wrong numbers
3. Re-creating a collection with the same name doesn't recover the old memberships (different `_id`)
4. Database accumulates unbounded orphan records over time

Worse: if the deletion mutation tries to delete all junction records AND the collection in a single transaction, it can hit Convex's per-transaction limits. A user with 1000+ items in a collection would require deleting 1000+ `collectionItems` documents plus the collection itself -- Convex allows max 16,000 document writes per transaction but scanning 1000+ documents also burns the 32,000 document scan budget.

**Why it happens:**
Convex has no foreign key constraints or cascade delete built in. Developers coming from SQL assume the ORM handles it. In Convex, you must manually delete related documents. The mutation looks "done" after `ctx.db.delete(collectionId)` because the UI immediately stops showing the collection (reactive query updates).

**How to avoid:**
- Implement cascade delete in the collection deletion mutation. Query all `collectionItems` with `.withIndex("by_collection", q => q.eq("collectionId", id))`, then delete each one, then delete the collection.
- For collections with fewer than ~500 items, do this in a single mutation (well within Convex's 16,000 write limit).
- For potentially large collections, use the scheduled deletion pattern: (1) soft-delete the collection by setting a `deletedAt` field, (2) filter out soft-deleted collections from all queries, (3) schedule a background mutation that deletes junction records in batches of 500, (4) delete the collection document after all junction records are cleaned up.
- Add a guard in junction-table queries: if `ctx.db.get(collectionId)` returns `null`, skip/delete the orphan record (self-healing).

**Warning signs:**
- Collection delete mutation has no junction table cleanup code
- `collectionItems` table row count only grows, never shrinks
- UI shows "1 collection" badge on items after their only collection was deleted

**Phase to address:** Phase 3 (Collection CRUD) -- cascade delete must be part of the delete mutation from the start, not added as a bug fix later.

---

### Pitfall 5: Auth Guard Inconsistency Between Library Reads and Writes

**What goes wrong:**
The codebase has two auth patterns: `getCurrentUser()` (returns `null` for unauthenticated -- used in queries) and `requireAuth()` (throws `UNAUTHENTICATED` error -- used in mutations). If library queries use `getCurrentUser()` and return empty results for unauthenticated users (silent failure), but library mutations use `requireAuth()` and throw errors, the UX is inconsistent: an unauthenticated user can visit `/library`, see an empty page (no error), try to rate a paper, and get a hard error.

More dangerously: if a library query forgets BOTH guards and uses `ctx.auth.getUserIdentity()` directly without checking ownership, a user could potentially read another user's library items by guessing document IDs (Convex IDs are not sequential but are guessable if leaked).

**Why it happens:**
The existing codebase uses both patterns (see `users/queries.ts` using `getCurrentUser` which returns null, vs the `requireAuth` pattern in mutations). Developers copy the query pattern for new library queries but don't consider the full flow. The "return null" pattern is correct for queries like "get my subscription" where a null result is meaningful, but wrong for `/library` where absence of auth should redirect, not show empty.

**How to avoid:**
- For ALL library queries AND mutations: use `requireAuth(ctx)` which throws on unauthenticated. The `/library` page should never silently show empty for a logged-out user.
- Add `userId` ownership check on EVERY library/collection operation: `if (item.userId !== user._id) throw createError("FORBIDDEN", ...)`. Follow the `resolveOwnedJob` pattern from `convex/extraction/queries.ts` -- create a `resolveOwnedLibraryItem` helper.
- On the Next.js side: protect the `/library` route with Clerk's middleware so unauthenticated users are redirected to sign-in before the page loads. This is defense-in-depth (Convex guards are the real protection).
- Never expose a query like `getLibraryItem({ id })` without ownership validation -- the item must belong to the requesting user.

**Warning signs:**
- Library query uses `getCurrentUser()` instead of `requireAuth()`
- Library query takes an `itemId` argument without checking that the item's `userId` matches the caller
- `/library` page shows empty state for unauthenticated users instead of redirect/login prompt
- No test verifies that User A cannot read User B's library items

**Phase to address:** Phase 1 (Schema + auth helpers) -- establish the `resolveOwnedLibraryItem` pattern before any query/mutation code is written. Phase 2 should include auth boundary tests.

---

### Pitfall 6: Stale Library Items When OpenAlex Source Data Changes

**What goes wrong:**
Library items store a snapshot of paper metadata at save time. OpenAlex updates its data continuously: citation counts change, retractions happen, new authors are added, DOIs are corrected, abstracts are updated. A paper saved in January 2026 with `citationCount: 45` may have `citationCount: 312` by December 2026. If the library displays the stale snapshot, users see outdated citation counts, miss retraction notices, and export incorrect metadata.

The risk is higher for academic tools where citation accuracy matters. A systematic review that exports library data with stale citation counts undermines the research.

**Why it happens:**
Storing the full paper snapshot at save time is the simplest implementation. Developers think "the user saved this, so they want what they saved." But users actually want a living bookmark, not a dead snapshot. The distinction between "save the reference" and "save the data" is not made explicit in the requirements.

**How to avoid:**
- **Store minimal metadata + canonical ID.** The `openalexId` is the canonical reference. Store enough metadata for display (title, authors, year, DOI) but accept that citation counts, open access status, and other mutable fields will go stale.
- **Display stale data with age indicator.** Show "Saved 3 months ago" next to library items. Users understand that citation counts may be outdated.
- **Do NOT implement background refresh for v2.1.** This is a premature optimization that adds complexity (cron jobs, rate limiting against OpenAlex API, conflict resolution). OpenAlex's free API has rate limits (10 requests/second), and refreshing 1000 library items would take 100+ seconds.
- **Provide a manual "refresh" button per item** that fetches current data from OpenAlex and updates the library item. This is simple, user-initiated, and respects API rate limits.
- **For export:** Always fetch fresh data from OpenAlex at export time, not from the stored snapshot. This ensures exported data is current.

**Warning signs:**
- Library items show citation counts from months ago with no staleness indicator
- Users report "wrong" citation counts in library vs. search results for the same paper
- Background cron implemented to refresh library items, hitting OpenAlex rate limits
- No `savedAt` timestamp displayed alongside library item metadata

**Phase to address:** Phase 2 (Library queries) -- display `savedAt` and accept staleness. Manual refresh is a Phase 4 enhancement, not a launch blocker.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `v.any()` for the library item data field | No need to define schema for OpenAlex data upfront | No type safety, no validation, document size unconstrained, impossible to add indexes later | Never -- define the schema even if it means omitting fields |
| Storing `collectionIds: v.array(v.id("collections"))` on library items instead of junction table | One fewer table, simpler queries for "which collections is this item in?" | Cannot index arrays, "all items in collection X" requires full table scan, collection delete requires scanning all items | Never -- junction table is the correct pattern for many-to-many in Convex |
| Loading all library items and filtering/paginating client-side | Works immediately, reuses existing `results-list.tsx` pagination pattern | Breaks at 200+ items (memory, bandwidth, render time), Convex bandwidth costs scale linearly | Acceptable for MVP if library is capped at ~100 items; must be replaced before removing cap |
| Skipping ownership check on queries (relying on "users only see their own data in the UI") | Faster development | Any direct API call or URL manipulation exposes other users' data | Never -- always validate `item.userId === user._id` server-side |
| Storing rating only in Zustand (existing `useRatingsStore`) and also in Convex library without sync | Existing rating system keeps working | Two sources of truth for ratings; Zustand ratings lost on device switch; Convex ratings may conflict with Zustand ratings | Acceptable as transitional state during migration, with explicit plan to deprecate Zustand ratings |

---

## Integration Gotchas

Common mistakes when connecting library features to the existing system.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Rating -> Library save trigger | Rating a paper in search results calls a Convex mutation that fails silently if the paper is already in the library, creating duplicate entries | Use upsert pattern: query `libraryItems` by `userId + openalexId` index first. If exists, update the rating. If not, insert. Use a composite index `by_user_openalex` on `["userId", "openalexId"]` for O(1) lookup. |
| Zustand ratings -> Convex library migration | Copying all Zustand ratings to Convex on first library page visit, creating a massive batch mutation | Do not bulk-migrate. Let ratings sync naturally: when user rates a paper, save to both Zustand (for immediate UI) and Convex (for persistence). Existing Zustand ratings are ephemeral and were never promised to persist. |
| Clerk auth + Convex library | Using `useUser()` from Clerk to check auth on the library page client-side, but not passing the auth token to Convex queries | Convex queries automatically receive the auth token from `ConvexProviderWithClerk`. Do not manually pass auth -- use `requireAuth(ctx)` in the Convex query function. The existing pattern in `convex/lib/auth.ts` handles this correctly. |
| OpenAlex SDK types in Convex schema | Importing `Work` type from `@sickrin/openalex-sdk` in Convex schema, causing build errors because the SDK is a client-side dependency | Define a separate `LibraryItemData` type in the Convex schema using Convex validators (`v.string()`, `v.number()`, etc.). Do not import SDK types into Convex backend code. |
| Search results page + library save | Adding a "Save to Library" button on search results that opens a modal, but the search page loses its scroll position when the modal triggers a re-render | Use `useMutation` with optimistic updates. The save operation should not cause the search results to re-fetch or the page to re-render. Convex mutations do not affect queries on different tables. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all library items to count per-collection badges | UI is snappy with 20 items; freezes with 500+ | Use a dedicated query that counts `collectionItems` per collection using `.withIndex("by_collection").collect().length`. Consider Convex Aggregate component for O(1) counts if scale demands it. | 200+ library items |
| Reactive query on entire library for the list page | Page re-renders on every library change (new rating, new item, metadata update) | Paginate with cursor-based queries so only the visible page re-renders. Use `usePaginatedQuery` from Convex React. | 100+ items in library, any concurrent modification |
| N+1 query for collection names on library item cards | Each item card queries `collections` table for each of its collection memberships | Batch-fetch all collections for the user once (they're user-scoped and bounded), pass as context to item cards. Users won't have 100+ collections. | 50+ items displayed with 5+ collections each |
| Full-text search on library items using `.filter()` with string matching | Works fine at 50 items; scans entire table at 1000+ items | Use Convex search index: `.withSearchIndex("search_title", q => q.search("title", searchTerm))`. Define the search index in the schema. | 200+ library items with active search |
| Denormalized collection count on library items (stored `collectionCount` field) | Fast reads, but every collection add/remove must update the library item document, causing extra writes and potential OCC conflicts | Query junction table count on demand. The read cost is low with proper indexes. Denormalized counts create write amplification and consistency bugs. | When users frequently add/remove items from collections |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Library query accepts `userId` as an argument instead of deriving it from auth | Any authenticated user can read any other user's library by passing a different `userId` | Always derive `userId` from `requireAuth(ctx)._id` inside the Convex function. Never accept `userId` as an argument for user-scoped data. |
| Collection sharing endpoint without rate limiting | Malicious user enumerates all collection IDs to discover other users' research interests | Not applicable for v2.1 (no sharing), but if added later, validate ownership on every collection access. Convex IDs are not sequential but are deterministic -- do not treat them as secrets. |
| Library export includes sensitive fields (user internal IDs, Convex document IDs) | Exported JSON/CSV leaks internal identifiers | Strip `_id`, `_creationTime`, `userId`, and any Convex-internal fields from export output. Export only user-facing data. |
| Deleting a library item does not check ownership | Any authenticated user can delete any library item if they know the document ID | Delete mutation must verify `item.userId === user._id` before deleting. Follow the `resolveOwnedJob` pattern. |

---

## UX Pitfalls

Common user experience mistakes in library/collections features.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No confirmation dialog on collection deletion | User accidentally deletes a collection and loses all membership associations; items are NOT deleted but collection organization is lost | Show confirmation: "Delete collection '[name]'? Items in this collection will not be deleted, but will be removed from this collection." |
| Rating a paper from search results saves to library with no feedback | User doesn't know the paper was saved; visits library later and is confused by items they don't remember saving | Show toast: "Saved to Library" with optional "Undo" action. Make the save-on-rate behavior opt-in or clearly documented in onboarding. |
| Library page shows all items with no default sort | New users see a random-looking list | Default sort by `savedAt` descending (most recent first). This matches user mental model of "I just saved this, I should see it at the top." |
| Collection names not validated for uniqueness per user | User creates two collections named "Methods" and gets confused | Validate uniqueness of collection name per user in the create mutation. Return a clear error message. |
| Removing an item from a collection shows the item disappearing from the list with no way to find it | User panics thinking they deleted the paper | Show toast: "Removed from '[collection name]'. Item is still in your library." with "Undo" action. |
| Filter state not preserved in URL | User filters library, copies URL to share/bookmark, filter state is lost | Use `nuqs` URL state (already in the codebase) for library filter parameters. Follow the existing `SearchUrlParams` pattern. |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Library save mutation:** Has upsert logic (check existing by `userId + openalexId` before insert) -- not just blind insert that creates duplicates
- [ ] **Collection delete mutation:** Deletes ALL `collectionItems` junction records for the collection, not just the collection document
- [ ] **Library item delete mutation:** Deletes ALL `collectionItems` junction records for the item, not just the library item document
- [ ] **Ownership validation:** Every query and mutation for library/collection data validates `item.userId === currentUser._id`, not just that the user is authenticated
- [ ] **Pagination with filters:** Filters are applied via indexes or `convex-helpers` filter (not post-pagination JavaScript `.filter()`), ensuring full pages
- [ ] **Search index defined:** Schema includes a search index on `libraryItems` for title text search, not relying on client-side string matching
- [ ] **Collection name uniqueness:** Create mutation checks for existing collection with same name for the same user
- [ ] **Rating sync:** Rating a paper updates both the search-page UI state (Zustand) AND the Convex library item's rating field -- not one or the other
- [ ] **Auth on /library route:** Next.js middleware or page-level guard redirects unauthenticated users to sign-in, not just showing empty state
- [ ] **Empty states:** Library page has proper empty states for: no items, no items matching filter, no items in selected collection -- not a blank page
- [ ] **Mobile responsive:** Library page and collection management work on mobile viewport -- the existing search results page uses responsive grid modes

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Full OpenAlex JSON stored in library items (Pitfall 1) | HIGH | Write a migration mutation that reads each library item, extracts only needed fields into the new schema shape, writes the slimmed document back. Must be done in batches of 500 (Convex transaction limits). Cannot be done atomically. |
| Arrays used instead of junction table (Pitfall 2) | HIGH | Create the `collectionItems` table. Write a migration that reads each library item's `collectionIds` array, creates junction records, then removes the array field. Two-phase: write junction records first, then remove array field. |
| Pagination returns empty pages (Pitfall 3) | MEDIUM | Swap to `convex-helpers` filter or add appropriate indexes. Frontend pagination component must be updated to handle the new cursor-based API instead of page numbers. |
| Orphaned junction records from missing cascade delete (Pitfall 4) | LOW | Write a cleanup mutation that scans `collectionItems`, checks if each `collectionId` exists, deletes orphans. Run once, then fix the delete mutation to cascade properly going forward. |
| Auth guard missing on library queries (Pitfall 5) | LOW | Add `requireAuth` + ownership check to every library/collection query and mutation. No data migration needed, just code changes. But if data was already leaked, the damage is done. |
| Stale library data with no staleness indicator (Pitfall 6) | LOW | Add `savedAt` display to library item cards. No migration needed if `savedAt` / `_creationTime` is already stored. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Full JSON blob storage (Pitfall 1) | Phase 1 (Schema design) | Schema review: `libraryItems` table has explicit typed fields, no `v.any()`, document size under 2 KB per item |
| Missing junction table (Pitfall 2) | Phase 1 (Schema design) | Schema has `collectionItems` table with `by_collection`, `by_item`, and `by_collection_item` indexes |
| Pagination + filter mismatch (Pitfall 3) | Phase 2 (Library queries) | Load test: with 100+ items and rating filter active, every page returns the requested number of items (no undersized pages) |
| Missing cascade delete (Pitfall 4) | Phase 3 (Collection CRUD) | Test: after deleting a collection, `collectionItems` query by that collection ID returns zero results |
| Auth guard inconsistency (Pitfall 5) | Phase 1 (Auth helpers) | Test: unauthenticated call to every library query/mutation returns UNAUTHENTICATED error. Test: User A cannot read User B's library items. |
| Stale data without indicator (Pitfall 6) | Phase 2 (Library UI) | UI review: every library item card shows `savedAt` date. Export function fetches fresh data from OpenAlex. |
| Rating sync between Zustand and Convex | Phase 2 (Library mutations) | Test: rating a paper from search results updates both Zustand store AND creates/updates Convex library item |
| Collection name uniqueness | Phase 3 (Collection CRUD) | Test: creating two collections with the same name for the same user returns an error on the second attempt |
| Duplicate library items from missing upsert | Phase 2 (Library mutations) | Test: rating the same paper twice does not create two library items; the second call updates the existing item's rating |
| `/library` route unprotected | Phase 2 (Library page) | Test: unauthenticated navigation to `/library` redirects to sign-in |

---

## Sources

- [Convex Limits Documentation](https://docs.convex.dev/production/state/limits) -- 1 MiB document size, 1024 fields, 8192 array elements, 16 nesting depth, 32K document scan limit, 16K document write limit per transaction, database bandwidth pricing
- [Convex Pagination Documentation](https://docs.convex.dev/database/pagination) -- reactive pagination, dynamic page sizes, cursor-based pagination behavior
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) -- junction table pattern for many-to-many, dual indexing, composite index for existence checks
- [Take Control of Pagination (Convex Stack)](https://stack.convex.dev/pagination) -- `getPage()` helper, memory bloat from loading many pages, reactive stitching
- [Complex Filters in Convex (Convex Stack)](https://stack.convex.dev/complex-filters-in-convex) -- `filter` helper from `convex-helpers`, TypeScript filtering with pagination, performance characteristics
- [How to apply filter before pagination (Convex Community)](https://discord-questions.convex.dev/m/1283043121730420808) -- empty/small page problem when filtering after pagination
- [Cascade Delete Patterns (Convex Community)](https://discord-questions.convex.dev/m/1270300293984288779) -- manual cascade delete, scheduled deletion for large relations, soft delete pattern
- [Convex Ents](https://stack.convex.dev/ents) -- cascading delete helpers, soft deletion behavior, scheduled deletion across mutations
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- index-based filtering preferred over `.filter()`, denormalization guidance
- Codebase analysis: `convex/schema.ts` (existing schema patterns), `convex/lib/auth.ts` (`getCurrentUser` vs `requireAuth` patterns), `convex/extraction/queries.ts` (`resolveOwnedJob` ownership pattern, paginated query implementation), `lib/store.ts` (Zustand `useRatingsStore` with `persist`), `lib/types/search.types.ts` (`PaperResult = Work` type alias, `SearchFilters` interface), `components/results-list.tsx` (client-side pagination pattern)

---
*Pitfalls research for: v2.1 Library & Collections -- OpenAlex Count (Next.js + Convex)*
*Researched: 2026-02-28*
