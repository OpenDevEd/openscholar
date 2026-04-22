# Plan 01 — Library Paginated Surface

## Goal

Move the mounted library page off the full-corpus `listLibrary` subscription and onto a paginated mounted path, while removing the live `getLibraryCount` scan fallback by guaranteeing `users.libraryItemCount`.

## Scope

In scope:

- replace the mounted `listLibrary` usage in [`components/library/library-page-client.tsx`](../../components/library/library-page-client.tsx) with a paginated mounted path,
- reuse or adapt [`browseLibrary`](../../convex/library/queries.ts) and [`searchLibrary`](../../convex/library/queries.ts) as the mounted queries,
- keep a full-corpus query only for explicit export/download flows, not the mounted page,
- guarantee `users.libraryItemCount` for mounted count reads and remove the query scan fallback,
- preserve existing library filter/search/sort behavior,
- keep collection filtering server-side and bounded.

Out of scope:

- redesigning library UI,
- semantic/vector search,
- global provider work for unrelated pages,
- any new npm package.

## Design

1. **Mounted reads switch to paginated queries.**
   The page currently subscribes to the full filtered corpus via `listLibrary`. Replace that with routed use of `browseLibrary` and `searchLibrary` through `useProtectedPaginatedQuery`.

2. **Keep full-corpus reads explicit and point-in-time.**
   Export/download actions that truly need the full filtered set should use an explicit point-in-time drain or explicit `convex.query(...)` call, not a mounted live query.

3. **Do not add a new aggregate for counts.**
   `users.libraryItemCount` is already the right denormalized count source. Add a bounded backfill/init path for missing rows, then remove the scan fallback from `getLibraryCount`.

4. **Prefer existing indexes/search indexes over new schema work.**
   The sort indexes and `search_library` index already exist. Only add schema if tests show the paginated path still cannot narrow enough.

5. **Keep the mounted row shape as small as possible without breaking the current cards/focus mode.**
   Start by paginating current rows. If payload is still too large per page, add a library list-row projection in the same plan instead of keeping the broad mounted path.

## TDD sequence

1. Extend `convex/library/queries.test.ts` with red tests for paginated browse/search behavior under the mounted filter combinations.
2. Add a red test proving `getLibraryCount` no longer scans when `libraryItemCount` is backfilled/present.
3. Green the query/backfill work in Convex first.
4. Add red React tests for `LibraryPageClient` proving only mounted-page rows render and pagination changes query behavior rather than local slicing.
5. Green the client cutover.
6. Refactor export/download paths to explicit point-in-time full-set reads and keep tests green.

## Files touched

- `convex/library/queries.ts`
- `convex/library/mutations.ts`
- `convex/library/queries.test.ts`
- `components/library/library-page-client.tsx`
- `components/library/*.test.tsx` as needed
- optional bounded backfill helper under `convex/library/` or `convex/maintenance/`

## Migration stance

Additive only.

- Backfill `users.libraryItemCount` where missing.
- Remove the live query fallback after the backfill/helper exists.
- No compatibility path that keeps the mounted full-corpus subscription once the paginated path lands.

## Test plan

- Convex query tests for `browseLibrary` and `searchLibrary` pagination/filter/search combinations.
- Convex query tests for `getLibraryCount` with and without preexisting `libraryItemCount`.
- React behavior tests for mounted pagination, search, collection filters, and export behavior.
- Manual smoke:
  - large library user,
  - first page loads only page-sized rows,
  - next/previous page works,
  - export still returns full filtered corpus.

## Acceptance criteria

- The mounted library page no longer subscribes to `api.library.queries.listLibrary`.
- First paint on the mounted library page reads only one page of rows, not the full filtered corpus.
- Search and browse both keep server-side pagination.
- `getLibraryCount` no longer scans `libraryItems` on a mounted read path.
- Export/download flows that need the full filtered set still work via explicit non-mounted reads.

## Known pitfalls

- `usePaginatedQuery` keeps loaded pages live. That is acceptable here because it still bounds the mounted read set to visited pages; do not regress to a mounted full-corpus query.
- Preserve collection-filter ownership checks and empty-result behavior from the current queries.
- Do not accidentally make export page-sized.

