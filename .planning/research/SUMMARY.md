# Project Research Summary

**Project:** v2.1 Library & Collections — OpenAlex Count
**Domain:** Persistent library with collections for academic search and extraction tool
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

This milestone adds a server-persisted library to an existing Next.js 16 + Convex 1.32 + Clerk academic search tool. The core architectural shift is moving ratings from client-only Zustand localStorage to Convex-backed documents: when a signed-in user rates a paper, slim normalized metadata is saved to a new `libraryItems` table. Collections are layered on top as a junction-table many-to-many relationship. The existing codebase already has every technology required — zero new npm dependencies are needed. The main implementation challenge is correctly designing the Convex schema and query patterns before writing any code, because schema decisions are difficult to reverse once data exists.

The recommended approach is a two-phase build: (1) core library — save on rate, `/library` page with filtering, text search, sort, and remove; (2) collections — CRUD, item assignment, filter by collection. This order is driven by hard data dependencies (collections require `libraryItems` to exist first) and by the fact that the library alone delivers the primary user value (cross-device persistence of rated papers). Research from Elicit, Zotero, Semantic Scholar, and Mendeley confirms this is the standard feature set for academic library tools.

The top risks are all schema-level and must be addressed before any mutations are written. Three schema pitfalls have HIGH recovery cost if missed: (1) storing the full OpenAlex `Work` blob (~5-30 KB) instead of a slim normalized document, (2) using array fields instead of a junction table for collection membership, and (3) applying TypeScript filters after `.paginate()` which produces undersized pages. All three have well-understood prevention strategies documented in Convex's official documentation and confirmed against the existing codebase.

---

## Key Findings

### Recommended Stack

No new packages are required. The existing stack covers every v2.1 need: Convex 1.32 for data storage, search indexes, and pagination; `convex-helpers` 0.1.112 (already installed, not yet used) for `getManyVia` junction table traversal; `nuqs` 2.8.8 for URL-driven filter state; Zustand 5.0.5 as an optimistic write-through cache for ratings; `sonner` for toast feedback; and the full shadcn/Radix component library for UI. The existing Command Center UI pattern (`CommandCenterContainer`, `CommandCenterToolbar`, `CommandCenterList`, `CommandCenterPagination`) provides the `/library` page shell with minimal new components needed beyond library-specific cards and collection management dialogs.

**Core technologies:**
- **Convex `searchIndex`**: Full-text search on library items — native Convex feature, reactive, scoped to user, supports pagination; no external search service needed for personal library scale
- **Convex compound indexes**: Filter/sort by `userId + rating`, `userId + savedAt`, `userId + publicationYear` — enables efficient index range queries without post-fetch filtering
- **Convex `.paginate()` + `useProtectedPaginatedQuery`**: Cursor-based server-side pagination — established pattern from extraction queries; wrapper hook already built in `lib/auth/use-auth-query.ts`
- **Junction table + `getManyVia`**: Many-to-many item-to-collections — only correct Convex pattern (arrays are not indexable); `getManyVia` from `convex-helpers` eliminates boilerplate
- **`nuqs` URL state**: Filter/sort state on `/library` page — already in use for pagination; extend with `parseAsString`, `parseAsStringLiteral` for filter params to make views bookmarkable

### Expected Features

Research against Elicit, Zotero, Semantic Scholar, Mendeley, and Paperpile confirms the following feature tiers.

**Must have (table stakes) — launch blockers:**
- Auto-save on rating (rating IS the save action in this product)
- Full paper metadata stored (title, authors, DOI, abstract, year — NOT raw OpenAlex blob)
- Dedicated `/library` page with item list, item count, and empty state
- Text search within library (title + authors + abstract via single `searchableText` field)
- Filter by rating (reuse existing `RatingRangePicker` component)
- Sort options: date saved, rating, publication year
- Collection CRUD (create, rename, delete) — flat, not nested
- Multi-collection assignment (many-to-many, not exclusive folders)
- Remove from library (delete with confirmation)
- Remove from collection without deleting from library (distinction is critical)
- Auth-gated access with redirect, not silent empty state
- Server-side pagination (Convex `.paginate()`, not client-side slicing)

**Should have (differentiators) — high value, low complexity:**
- Filter by date saved
- Filter by collection on main library view
- Filter by publication year range
- Collection item count badges (denormalized `itemCount` on `collections` table)
- View mode switching (list-detail / grid — pattern already exists in codebase)
- Export library items (reuse existing `jsonToCSV`/`downloadAsFile` utilities)

**Defer to v2.2+:**
- Bulk operations (multi-select + bulk-add/remove/delete)
- Bridge to extraction workflow ("extract from these saved papers")
- Bidirectional rating sync between search results and library
- "Already saved" indicator on search result cards
- Manual "refresh" button to fetch fresh OpenAlex metadata per item

**Confirmed anti-features (do not build):**
- Nested/hierarchical collections (tree views, drag-drop, breadcrumbs — significant complexity for minimal MVP value)
- Tags as a separate organizational system (parallel to collections, confuses users)
- Smart collections / saved searches (requires continuous query engine; too complex for v2.1)
- PDF storage and annotation (scope expansion; users have Zotero for this)
- Citation formatting / BibTeX export (entire product category; Zotero already integrated)
- Collaborative/shared libraries (requires permission models; v3+ at earliest)

### Architecture Approach

The architecture follows the existing domain module pattern. New Convex modules go in `convex/library/` and `convex/collections/` alongside existing `convex/users/`, `convex/credits/`, and `convex/extraction/`. Three new Convex tables are required: `libraryItems` (one row per user per paper; stores slim normalized metadata plus `paperData: v.any()` blob for display-only rendering), `collections` (user-created groupings with denormalized `itemCount`), and `libraryItemCollections` junction table (many-to-many with dual indexes). The `RatingSelector` component is modified to trigger a Convex mutation when the user is authenticated, while retaining Zustand as fallback for anonymous users. A critical two-code-path strategy is required on the library page: search mode (uses `withSearchIndex`, relevance order) vs. browse mode (uses `withIndex`, custom sort) — Convex cannot sort search results by arbitrary fields.

**Major components:**
1. `convex/library/mutations.ts` — upsert save, remove item, update rating; all library write operations
2. `convex/library/queries.ts` — paginated list with filter/sort, `getItemRating`, dual search/browse code paths
3. `convex/collections/mutations.ts` — CRUD plus addItem/removeItem with cascade delete and atomic `itemCount` updates
4. `convex/collections/queries.ts` — list collections, get collection items via junction table traversal
5. `components/library-command-center/` — new page shell reusing Command Center pattern; includes toolbar, item cards, collection manager dialog, collection picker popover
6. `lib/hooks/use-library-rating.ts` — dual-path rating hook (Convex for authenticated, Zustand fallback for anonymous)

### Critical Pitfalls

1. **Storing full OpenAlex `Work` blob as-is (HIGH recovery cost)** — A Work JSON is 5-30 KB with 40+ fields including deeply nested authorships, `abstract_inverted_index`, `referenced_works[]` (often 30-100 IDs), and `related_works[]`. Stored verbatim, 200+ items causes 3+ MB page loads and Convex bandwidth billing. Prevention: define a slim schema with explicit typed fields for the 10-12 fields needed for display and filtering; strip `referenced_works`, `related_works`, `abstract_inverted_index`, `grants`, `apc_list`, `mesh` before storage. Target 1-2 KB per document. A `trimPaperData(work: Work)` utility should be the first function written in Phase 1.

2. **Arrays instead of junction table for collection membership (HIGH recovery cost)** — Convex arrays cannot be indexed. Querying "all items in collection X" from an array field requires a full table scan. Prevention: always use the `libraryItemCollections` junction table with `by_collection`, `by_item`, and `by_item_collection` indexes. The composite index enables O(1) existence checks. Schema must include the junction table from Phase 1 even though collection UI ships in Phase 4.

3. **Pagination + TypeScript filter mismatch (MEDIUM recovery cost)** — Using `.paginate()` then filtering in TypeScript produces undersized or empty pages. Prevention: express all filters via Convex indexes (`withIndex`) or the search index (`withSearchIndex`). Use `convex-helpers` `filter` only for non-indexable predicates. Never use `.paginate()` followed by an array `.filter()`.

4. **Collection deletion without cascade (accumulates over time)** — Convex has no foreign key cascade. Deleting a `collections` document without deleting its `libraryItemCollections` rows leaves orphaned junction records. Prevention: collection delete mutation must query and delete all junction rows before deleting the collection document — implement this from day one.

5. **Auth guard inconsistency (HIGH security risk)** — Library queries that use `getCurrentUser()` (returns null) instead of `requireAuth()` (throws) silently show empty state for unauthenticated users. Queries that accept `itemId` without ownership validation expose other users' data. Prevention: every library/collection query and mutation uses `requireAuth(ctx)` and validates `item.userId === user._id`. Follow the `resolveOwnedJob` pattern from `convex/extraction/queries.ts`.

---

## Implications for Roadmap

Both FEATURES.md and ARCHITECTURE.md independently converge on the same 10-step build order. The dependency chain is unambiguous: schema precedes mutations, mutations precede UI, and the library concept must precede collections. The suggested phases below reflect this, grouping the 10 steps into logical deliverable increments.

### Phase 1: Foundation — Schema, Auth Helpers, and Rating Bridge

**Rationale:** Schema decisions are irreversible without data migrations. All three HIGH-cost pitfalls (blob storage, array membership, auth inconsistency) manifest at the schema layer. This phase also wires the rating-to-save bridge, which is the entry point for all library data — nothing else works without it.

**Delivers:** Three new Convex tables with correct indexes and search index; `trimPaperData` utility; upsert save mutation; rating mutation wired into `RatingSelector` with Zustand fallback for anonymous users; `resolveOwnedLibraryItem` auth helper; toast on save.

**Addresses:** Auto-save on rating, full metadata storage (table stakes)

**Avoids:** Pitfall 1 (blob schema — slim documents from day one), Pitfall 2 (array membership — junction table schema defined now even though collection UI ships later), Pitfall 5 (auth guard inconsistency — `requireAuth` + ownership pattern established before any other code)

**Research flag:** SKIP — schema design is fully documented in STACK.md with exact TypeScript definitions. No additional research needed.

### Phase 2: Core Library Page

**Rationale:** With data flowing into `libraryItems`, the dedicated page is the minimum user-visible deliverable. This phase establishes the dual-path query strategy (search vs. browse) and server-side pagination before the collection filter adds a third query path.

**Delivers:** `/library` route (auth-gated with redirect); `LibraryCommandCenter` shell; paginated list view (default sort: `savedAt` desc); text search via `searchIndex` on `searchableText` field; filter by rating (reuse `RatingRangePicker`); sort dropdown (savedAt, rating, year); remove from library with confirmation; empty states (no items; no items matching filter); `savedAt` display on cards for staleness awareness.

**Addresses:** Dedicated library page, text search, filter by rating, sort options, remove from library, auth-gated access, pagination, empty state (all table stakes)

**Avoids:** Pitfall 3 (pagination + filter mismatch — dual code path established here), Pitfall 6 (stale data — `savedAt` displayed on every card)

**Research flag:** SKIP — pagination pattern mirrors existing `useProtectedPaginatedQuery` in extraction queries; Command Center pattern is established; two-code-path strategy is fully documented in STACK.md.

### Phase 3: Filter State and URL Persistence

**Rationale:** Filter/sort state must be in the URL for bookmarkable views. This is a separate phase because it touches the query layer (adding date and year filters) and the URL state layer simultaneously. The collection filter query path can be built here even though the collection UI ships in Phase 4.

**Delivers:** `nuqs`-based URL state for all filter params (`q`, `rating`, `collection`, `sort`); filter by date saved; filter by publication year; collection filter query path (UI wired in Phase 4); view mode switching.

**Addresses:** Filter by date saved, filter by collection, filter by publication year, view mode switching, bookmarkable URLs (differentiators)

**Research flag:** SKIP — `nuqs` pattern is already established in the codebase; URL state design with `parseAsString`, `parseAsStringLiteral`, `parseAsInteger` is specified in STACK.md.

### Phase 4: Collections

**Rationale:** Collections depend on `libraryItems` existing (Phase 1) and the junction table being in the schema (Phase 1). The UI depends on the library page shell (Phase 2). The collection filter query path exists (Phase 3) and needs only the UI wired. This is the last core feature of v2.1.

**Delivers:** `collections` and `libraryItemCollections` mutations and queries; collection CRUD UI (create/rename/delete with confirmation dialog); collection picker popover for item assignment; multi-collection membership; remove from collection (without deleting from library) with toast; filter library by collection (via Phase 3 query path); collection item count badges; cascade delete on collection removal.

**Addresses:** Collection CRUD, multi-collection assignment, remove from collection, filter by collection, item count badges (table stakes + differentiators)

**Avoids:** Pitfall 4 (cascade delete built from the start); collection name uniqueness validated in create mutation; `itemCount` incremented/decremented atomically.

**Research flag:** SKIP — junction table pattern, `getManyVia` usage, cascade delete patterns all documented with working code in STACK.md and PITFALLS.md. No novel patterns.

### Phase 5: Export and Polish

**Rationale:** Export is low-complexity (reuse existing utilities). Polish items (mobile responsiveness, edge-case empty states, toast/undo for all destructive actions, i18n) should be a dedicated phase rather than scattered across earlier phases.

**Delivers:** Export library items as CSV/JSON (reuse `jsonToCSV`/`downloadAsFile`); mobile responsive library page and collection dialogs; toast + undo for all destructive actions (remove from library, delete collection, remove from collection); i18n strings for all new library/collection UI (6 locales in `messages/*.json`).

**Addresses:** Export library items, mobile responsiveness, full i18n coverage (differentiators + production quality)

**Research flag:** SKIP — export utilities, i18n namespace pattern, and toast patterns are all established in the codebase.

### Phase Ordering Rationale

- **Schema first, always.** Pitfalls 1, 2, and 5 all manifest at the schema layer with HIGH recovery cost or HIGH security risk. Establishing the correct schema before any mutations are written makes all subsequent phases safe.
- **Library before collections.** Collections reference `libraryItems` IDs. The library page UX must exist before users can meaningfully interact with collections. Phases 1-2 can ship as an incremental release before Phase 4.
- **Filters after core page.** URL state and additional filters add complexity to the query layer. Building the core page first with a single sort dimension, then adding filter/sort state, reduces the risk of getting the pagination strategy wrong.
- **Collection filter query path in Phase 3, not Phase 4.** Separating the query logic (Phase 3) from the collection UI (Phase 4) keeps Phase 4 focused on UI work and ensures the query is independently testable.
- **Export and polish last.** High value for production quality but no functional dependencies from other phases.

### Research Flags

Phases likely needing deeper research during planning:
- **None.** All four research files are HIGH confidence, sourced from official Convex documentation and direct codebase inspection. Technology stack is mature and patterns are fully documented with working TypeScript examples.

Phases with standard patterns (skip research-phase):
- **All phases.** Convex patterns (search index, junction table, paginated queries, `getManyVia`, `nuqs` URL state) are thoroughly documented with working code in STACK.md and ARCHITECTURE.md. UI patterns (Command Center shell, `RatingSelector` mutation wiring, `useProtectedPaginatedQuery`) map directly to existing components in the codebase.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All patterns sourced from Convex official docs + direct codebase inspection. Zero new dependencies required, all existing packages verified compatible. Full TypeScript code examples provided. |
| Features | HIGH | Cross-referenced against Elicit, Zotero, Semantic Scholar, Mendeley, Paperpile. Existing codebase inspected to confirm current capabilities and gaps. Feature tiers are well-supported by multiple independent sources. |
| Architecture | HIGH | Build order derived from hard data dependencies (not opinion). Every component maps to an existing codebase pattern with a concrete modification or new-file target. No speculative patterns introduced. |
| Pitfalls | HIGH | All critical pitfalls sourced from Convex official docs, community Discord, and confirmed GitHub issues. Recovery costs are concrete estimates based on Convex's documented transaction limits and migration patterns. |

**Overall confidence:** HIGH

### Gaps to Address

- **`paperData` trimming strategy — what exactly to strip.** STACK.md recommends `v.any()` with trimmed data; PITFALLS.md warns strongly against full blobs. The resolution is to use `v.any()` but define exactly which OpenAlex fields to strip before storage. A concrete `trimPaperData(work: Work): TrimmedWork` utility must be defined as the first deliverable in Phase 1. Candidate fields to strip: `referenced_works`, `related_works`, `abstract_inverted_index`, `grants`, `apc_list`, `biblio`, `mesh`, `sustainable_development_goals`, `keywords`, full nested `authorships` (retain author names only). Verify final list against what the library item cards actually render.

- **Zustand rating hydration divergence.** When an authenticated user visits search results, their Zustand store (localStorage) may contain ratings that diverge from Convex (e.g., ratings set on another device). ARCHITECTURE.md notes this as acceptable transitional state for v2.1. The UX consequence — stale localStorage ratings shown on search results for papers re-rated elsewhere — should be verified during Phase 2 and addressed if user-visible inconsistency is significant.

- **Collection filter + text search combination.** The two-code-path strategy (search index vs. regular index) does not address the case where a user simultaneously has a text search query AND a collection filter active. This requires either (a) a third query path (search scoped to user, then cross-reference junction table) or (b) accepting that text search ignores the collection filter in v2.1. This edge case should be explicitly decided and documented at the start of Phase 4 planning.

---

## Sources

### Primary (HIGH confidence)

- [Convex Full Text Search docs](https://docs.convex.dev/search/text-search) — search index definition, filterFields, 1024 result limit, relevance ordering, 1 searchField per index
- [Convex Indexes docs](https://docs.convex.dev/database/reading-data/indexes/) — compound indexes, 32 per table limit, index ordering rules
- [Convex Pagination docs](https://docs.convex.dev/database/pagination) — cursor-based pagination, reactive page sizes, dynamic page size from filtering
- [Convex Limits docs](https://docs.convex.dev/production/state/limits) — 1 MiB document limit, 8192 array elements, 32K scan / 16K write limits per transaction
- [Convex Relationship Structures](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas) — junction table pattern, dual indexing, composite index for existence checks
- [convex-helpers Relationship Helpers](https://stack.convex.dev/functional-relationships-helpers) — `getManyVia`, `getManyFrom` import paths and usage
- [convex-helpers Complex Filters](https://stack.convex.dev/complex-filters-in-convex) — `filter` helper, hybrid index + filter, known issue #864 (variable page sizes with `.paginate()`)
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) — index-based filtering, denormalization guidance
- [Elicit Library documentation](https://support.elicit.com/en/articles/1499969) — library feature set baseline
- [Elicit Collections documentation](https://support.elicit.com/en/articles/7928641) — collections UX patterns, flat vs. nested decision
- [Zotero organization guide](https://guides.library.oregonstate.edu/c.php?g=359201&p=2426087) — reference manager feature baseline
- Direct codebase inspection: `convex/schema.ts`, `convex/lib/auth.ts`, `convex/extraction/queries.ts`, `lib/store.ts`, `lib/auth/use-auth-query.ts`, `components/rating-selector.tsx`, `components/bookmarks-command-center/index.tsx`, `package.json`

### Secondary (MEDIUM confidence)

- [Semantic Scholar Library features](https://www.semanticscholar.org/faq) — library/folder feature confirmation
- [Paperpile: Zotero vs Mendeley comparison](https://paperpile.com/r/zotero-vs-mendeley/) — reference manager feature matrix
- [Research.com reference manager comparison](https://research.com/software/best-reference-management-software) — feature tier validation
- [Convex cascade delete patterns (Discord)](https://discord-questions.convex.dev/m/1270300293984288779) — manual cascade, scheduled deletion for large relations
- [Complex filter + pagination issue (Discord)](https://discord-questions.convex.dev/m/1283043121730420808) — undersized page problem confirmed as expected Convex behavior
- [convex-helpers filter + pagination issue #864](https://github.com/get-convex/convex-helpers/issues/864) — variable page sizes with `filter` + `paginate`, confirmed not a bug

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
