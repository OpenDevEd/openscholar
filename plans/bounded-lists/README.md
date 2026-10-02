# Every list pages by cursor

Milestone OS-18. Workflow rules live in the root `AGENTS.md` and
`docs/agents/project.md`; this file holds the decisions and order.

## Problem

On 2026-10-02, 73 public functions returned a list outside a pagination page
(189 list paths counting nested ones), 71 database reads used `.collect()`, and
6 places loaded every page into one array. Each grows with use until it hits
Convex's limits or the browser's memory.

## Decisions (2026-10-02, the user)

- Everything a person or a service can add to pages by cursor. Infinite scroll
  is a cursor too. There is no "bounded because the rows stay few" category.
- Anything that consumes a paged list pages too. Clients load the next page
  when the person asks for it. Exports stream page by page instead of reading
  every page into one array.
- A list stored on a record has a cap enforced on write, by a database trigger,
  from one table of caps (`convex/lib/listCaps.ts`). A list that grows with use
  becomes its own table.
- Schemas and queries are optimized: each paged list reads through an index in
  the order it's shown, and counts are kept as rows change, never counted on
  read.
- The gate (#428) is `npm run check:convex-rules`. Existing cases are pending,
  each with its issue, and the pending lists only shrink.

## Reuse

- Server: `paginationOptsValidator` and `paginationResultValidator` from
  `convex/server`; `.paginate()` through an index; `getPage` and `stream` from
  `convex-helpers` for ranges and merged or filtered reads.
- Client: `usePaginatedQuery` (or `useProtectedPaginatedQuery`), the shared
  `Paged` and `pagerOf` from `components/settings/parts.tsx`, and
  `CommandCenterPagination`.
- Limits proof: `convex/limits/maxSize.test.ts` and
  `convex/lib/maxSize.test-support.ts`.

## Order and owners

1. #428: the gate, with every existing case pending. Ships first so no new case
   lands.
2. #426: write-time caps for list fields, and the gate rule that a schema list
   field has a cap. Most nested pending paths close here.
3. #420 (library and collections), #421 (screenings), #422 (extraction and
   chat), #423 (Evidence Library setup), #424 (account, admin and catalog),
   #425 (other services' APIs): each pages its functions and their consumers,
   with the index it needs, and removes its pending entries.
4. #427: the remaining whole-result reads become pages or enforced caps.

Each issue is one PR, or a few when an area is large. A PR removes the pending
entries it fixes; the gate fails if a fixed entry stays listed.

## Data

Paging changes no stored data. Caps (#426) audit shared dev first: a record
over its cap is migrated into a table with `@convex-dev/migrations`, never
trimmed. New indexes on large tables deploy staged first.

## Checks

- Each PR: `npm run check:convex-rules`, the affected Vitest files, a
  `maxSize.test.ts` case for the largest allowed size, and the changed pages in
  the browser.
- The milestone closes when `scripts/convex-rules.json` has no pending entries
  under `unboundedReads`, `listReturns` and `everyPage`.

## Risks

- Keys follow function and list path. Renaming a function with pending entries
  fails the shrink check; fix the entries in the same PR.
- The every-page rule reads syntax, so a helper that loads every page through a
  library (SWR's `setSize`, as `lib/zotero/collect-all-pages.ts` does) can slip
  past it. #425 removes that one; reviews watch for others.
