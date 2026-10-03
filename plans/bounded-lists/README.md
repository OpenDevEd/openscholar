# Every list pages by cursor

Milestone OS-18. Workflow rules live in the root `AGENTS.md` and
`docs/agents/project.md`; this file holds the decisions and order.

## Problem

On 2026-10-02, 73 public functions returned a list outside a pagination page
(189 list paths counting nested ones), 71 database reads used `.collect()`, and
12 places loaded every page into one array. Each grows with use until it hits
Convex's limits or the browser's memory.

## Decisions (2026-10-02, the user)

- Everything a person or a service can add to pages by cursor. Infinite scroll
  is a cursor too. There is no "bounded because the rows stay few" category.
- Anything that consumes a paged list pages too. Clients load the next page
  when the person asks for it. Exports stream page by page instead of reading
  every page into one array.
- A list stored on a record has a cap enforced on write. Its validator is
  wrapped in `capped(...)` with a constant from `convex/lib/listCaps.ts`, and
  every mutation's writes refuse more (`convex/lib/capWrites.ts`). A list that
  grows with use becomes its own table.
- 2026-10-02: the cap check moved from a database trigger to the write wrapper.
  The trigger read each row back after its write, which pushed the largest
  batches past Convex's 4,096 index ranges, and it rejected any later patch of a
  row saved over a cap. The wrapper checks only what a write sets and reads
  nothing.
- Schemas and queries are optimized: each paged list reads through an index in
  the order it's shown, and counts are kept as rows change, never counted on
  read.
- 2026-10-03: a numbered list steps previous and next with "page 3 of 12", the
  total from a kept count. It reads only the page shown; jumping to any page
  would read every row it skips. A picker searches on the server and loads the
  next page as it scrolls.
- The gate (#428) is `npm run check:convex-rules`. Existing cases are pending,
  each with its issue, and the pending lists only shrink.

## Reuse

- Server: `paginationOptsValidator` and `paginationResultValidator` from
  `convex/server`; `.paginate()` through an index; `getPage` and `stream` from
  `convex-helpers` for ranges and merged or filtered reads.
- Client: `useCursorPage` (`lib/hooks/use-cursor-page.ts`) with `PageStepper`
  (`components/shared/page-stepper.tsx`) for numbered lists; for pickers,
  `useProtectedPaginatedQuery` with `loadMore` from the list's scroll handler,
  as `components/library/use-collection-picker.ts` does. `Paged` and `pagerOf`
  from `components/settings/parts.tsx` and `CommandCenterPagination` jump to any
  page, so they suit only lists already in memory.
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

## The research session (#420, last part)

`lib/research/session.ts` keeps every saved search, query shortcut and rating in
client stores (`watchPages` reads every page), and about 27 files read those
stores whole. Signed out, the same stores live in the browser, so they stay;
signed in, each consumer reads only what it shows, through hooks that read the
local store or Convex by mode:

1. Searches. Lists (history page, sidebar recents, extraction and Evidence
   Library pickers) page through search summaries with no screening answers.
   The search a page works on is read by ID (`research/records:getSearch`).
   Edits keep their instant feel through Convex optimistic updates on those
   queries, replacing the session's pending-command overlay. Clearing history
   deletes in batches on the server.

   2026-10-03, as built: the pending-command overlay stays, applied to the
   searches read by ID, because every edit a page makes is to a search it is
   reading; optimistic updates would add a second mechanism for the same
   result. A list changes when its save lands. The history filter reads through
   the sort's index and keeps the rows whose query or questions contain the
   text, as the library's filters do, so it keeps the chosen sort and matches
   any part of a word; a full text index would do neither. An account's history
   export is written by the server through the library's export route
   (`convex/exports.ts`). Page totals come from a count row a trigger keeps
   (`migrations/pagedSearches` backfills it).
2. Ratings. A results page reads the ratings of the papers it shows, at most a
   results page's 200, by paper ID.
3. Shortcuts. The Bookmarks page pages them; a query's expansion reads only the
   shortcut names it uses.

Each stage is one PR and removes `watchPages` for its records; the last
removes it. The assistant's tools already read these records by page or ID.

## Data

Paging changes no stored data. Caps (#426) audit shared dev first: a record
over its cap is migrated into a table with `@convex-dev/migrations`, never
trimmed. New indexes on large tables deploy staged first.

On 2026-10-02 every list on shared dev fit its cap; three sat at it (paper
authors 100, extraction list answers 8, runtime release changes 250), and
their writers already cut to those. A write is checked on what it sets, so a
row saved over a cap still takes patches to other fields. A whole object
written back unchanged (a search's `data` on every edit) is checked again, so
any deployment with older data gets the same audit before it takes this
change.

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
