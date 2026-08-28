# Plan 13 — Large-list pickers

## Goal

Every list on the configuration page that comes from a library's database
works when it holds thousands of entries. Owners search and page on the
server; the browser never downloads a whole catalogue to filter it.

Four lists change. Two more are noted and deferred.

## Facts checked on 2026-08-28

1. **Institutions.** The runtime endpoint
   `GET /api/openscholar/institutions` (new-el
   `src/app/api/openscholar/institutions/route.ts` →
   `src/lib/admin/openscholar-institutions.ts`) runs one `GROUP BY` over all
   records and returns every institution name with its count. No `query`,
   no `cursor`, no limit. OpenScholar's action
   `convex/zotero/runtimeReadActions.ts` → `listRecordInstitutions` takes only
   `libraryId` and returns the whole array (`readRuntimeInstitutions` in
   `convex/zotero/runtimeReadClient.ts:128`). The picker
   (`components/evidence-libraries/configuration/sections/institution-pickers.tsx`,
   `InstitutionCombobox`) loads everything into a `Popover` + `Command` and
   filters in the browser. Used twice: the Institutions section (add a logo
   for an institution) and Search & filters (pinned institution).
2. **Collections.** The runtime endpoint
   `GET /api/openscholar/collections` already takes `query`, `cursor` and
   `pageSize` (`collection-catalog-service.ts`), and
   `listLibraryCollections` passes them. But the dialog in
   `collections-field.tsx` (`readCatalogue`, `MAX_PAGES = 100`) preloads the
   whole catalogue page by page when opened, then filters in the browser;
   server search only runs once the preload hits the cap ("Search the whole
   library").
3. **Navigation and footer link targets.** `link-editor.tsx` offers the
   "Collection" target as a plain `Select` over `collectionOptions(draft)` —
   the collections the owner chose to show. Bounded by the owner, but a
   `Select` with hundreds of rows is unusable.
4. **Zotero groups.** `libraryGroupActions.ts` → `listMyZoteroGroups`
   follows Zotero's `start`/`limit` paging up to `GROUPS_MAX_START = 1000`
   (Zotero refuses higher `start` values) and returns all rows; the dialog
   renders them all and filters in the browser. Zotero offers no group
   search, so 1,000 is the ceiling the API sets.
5. **Team** (`queries.ts` → `listTeam`) collects every organisation
   membership and looks each user up. **Versions**
   (`versions.ts` → `listVersions`) takes a fixed `MAX_VERSION_ROWS`. Both
   are bounded and deferred (see "Deferred").

## Decisions

1. One shared picker dialog in OpenScholar, `RemotePickerDialog`, built from
   the collections picker the user approved (`CollectionPicker` in
   `collections-field.tsx`: full-screen `Dialog`, search box, source filter
   chips where they apply, sortable table, checkbox rows, select-all,
   footer with the count and the confirm button). It is fed by a
   **server-driven source**: a function `(query, cursor) => page` that the
   dialog calls with the debounced search text (300 ms) and a "Load more"
   cursor. Nothing is preloaded. Sorting is a server parameter, not a
   client sort of a partial page. Single-select and multi-select modes.
2. The runtime institutions endpoint gets the same contract as collections:
   `query` (case-insensitive contains on the name), `cursor`, `pageSize`
   (default 50, max 200), `sort` = `count` (default, descending, then name)
   or `name`. Keyset paging, no offsets. The response shape is
   `{ items: [{ name, count }], nextCursor: string | null }`.
3. `listRecordInstitutions` takes `{ libraryId, query?, cursor?, sort? }`
   and returns `{ reason, items, nextCursor }`. The runtime read cache
   (`runtimeReads.ts`) keys institutions like collections
   (`collectionsCacheKey` pattern) so each page is cached on its own.
4. The institution picker becomes the shared dialog in single-select mode,
   in both places. "Type a name that is not on any record yet" stays for
   the Institutions section (`allowNew`) as a row at the top when the typed
   text matches nothing on the current page; the pinned-institution picker
   keeps `allowNone`.
5. Collections: the dialog uses the server source from the first
   keystroke. `readCatalogue`, `MAX_PAGES` and the truncated banner go.
   "Hide already shown" stays as a client filter of the current page. The
   source filter chips stay, also as a client filter: checked on
   2026-08-28, `GET /api/openscholar/collections` takes only `query`,
   `cursor` and `pageSize` (new-el `collection-catalog-service.ts`), so the
   chips list the sources of the pages already loaded.
6. Nav and footer "Collection" targets open the same dialog in single-select
   mode over the **shown** collections (the draft's list; it is local data,
   so the source is an in-memory page function over `collectionOptions`,
   paged at 50, searched by title). Same dialog, same look.
7. Zotero groups: keep the full fetch (the API's 1,000 cap is the ceiling),
   but the dialog pages the rows through the same in-memory source at 50
   per page with search, and says "Zotero stops listing after about 1,000
   groups" only when the cap is hit (Zotero refuses a `start` above 1,000,
   so the true end is 1,100 rows). `listMyZoteroGroups` returns a new `capped` field
   for that note; Zotero is asked once per open, not per page.
8. No new-el schema field changes, so no contract re-pin.
9. Sorting is offered only where the server sorts, and a sortable header
   can be turned around. The collections endpoint always orders by name,
   so its picker keeps plain column headers — that is correct, not a gap.
   Institutions have sortable Institution and Records headers that send
   `sort=name|count` and `direction=asc|desc`. The library carries both in
   its cursor and refuses a cursor reused with a different order, so
   changing a header always starts the list again; the arrow only appears on
   the header that is in use, and an unused sortable header carries the
   two-way arrow the approved picker used.
10. The collections a site shows are named from the library itself. Lane R
    adds `GET /api/openscholar/collections?ids=<up to 200, comma separated>`,
    which answers the same rows as a page — `{ id, title, source, count,
    parentId }` — in the order asked, with `nextCursor: null`, leaving out
    ids it does not know. `ids` cannot be combined with `query` or `cursor`;
    the library refuses that with 400. OpenScholar
    adds `resolveLibraryCollections({ libraryId, ids })`, cached per id set,
    and the configuration page reads it once for the ids the owner shows.
    The Collections section and every navigation and footer link editor read
    the same answer, so a row shows its database name and record count on
    first render. Until lane R merges, the runtime ignores `ids`; the client
    reads that as "not available yet" and shows the id, and never fails.
11. Dialog copy belongs to the list it shows. The dialog owns only the
    words that are the same everywhere (clear, select all, load more, try
    again, cancel, the selected count); each call site passes its own
    title, description, search label, column headers, loading line and
    failure line. The approved collections description keeps its words
    without the total, which no single page can know.

## Deferred, written down

- Team: page memberships and batch the user lookups once an organisation
  exceeds a few hundred members.
- Versions: cursor "Load more" past `MAX_VERSION_ROWS`.

## Lanes

| Lane | Repo | Branch | Owns |
|---|---|---|---|
| R · Runtime | new-el | `codex/institutions-paging` | `src/app/api/openscholar/institutions/**`, `src/lib/admin/openscholar-institutions.ts`, its tests, the OpenScholar read-API doc |
| P · Pickers | openalex-count | `codex/large-list-pickers` | `convex/zotero/runtimeReadActions.ts`, `runtimeReadClient.ts`, `runtimeReads.ts`, their tests; `components/evidence-libraries/configuration/sections/{institution-pickers,collections-field,link-editor,sources-field}.tsx`, a new `remote-picker-dialog.tsx`, their tests; `messages/*.json` keys they own |

Lane P starts at once against the collections endpoint (already paged) and
builds institutions to the contract in Decision 2; the institutions
end-to-end proof waits for lane R to merge.

## Test-first steps

### Lane R

0. `GET /api/openscholar/collections?ids=` and institutions `direction`
   (see Decisions 9 and 10), with their own route and service tests.
1. `openscholar-institutions.test.ts`: red → green for `query` (contains,
   case-insensitive), `sort=count` then `sort=name`, keyset `cursor`
   stability (no duplicates or gaps across pages when counts tie),
   `pageSize` clamp to 200, and an empty result.
2. Route test: bearer required; bad `cursor` → 400 with the admin error
   shape; response `{ items, nextCursor }`.
3. `npm run check:changed` (Fallow) before pushing. Update the read-API doc.

### Lane P

1. `runtimeReadClient.test.ts`: `readRuntimeInstitutions` sends `query`,
   `cursor`, `sort`, `direction`, `pageSize`, parses `nextCursor`; cache key
   per page; `readRuntimeCollectionsByIds` sends `ids` and reads a runtime
   that ignores them as "not available yet".
2. `runtimeReadActions` test: `listRecordInstitutions` validates args,
   refuses an unknown `sort` or `direction`, and returns `nextCursor`;
   `resolveLibraryCollections` answers the names and counts of the ids it
   was given.
2b. `remote-picker-dialog.test.tsx`: a slow answer for old search text never
   lands under new text, and "Load more" never mixes a new query with an old
   cursor.
3. `remote-picker-dialog.test.tsx`: typing calls the source with the
   debounced query; "Load more" passes the cursor and appends; single-select
   closes on choose; multi-select confirms the checked set; the empty state
   and the failure state (with retry) show; keyboard: Escape closes, arrows
   move rows.
4. `institution-pickers.test.tsx`: both call sites open the dialog; the
   chosen name lands in the draft; `allowNew` row appears only when nothing
   on the page matches.
5. `collections-field.test.tsx`: no preload on open; the first page arrives
   from the source with an empty query; search sends the typed text; "Add N"
   still adds; "hide already shown" filters the page.
6. `link-editor` test: the Collection target opens the dialog and writes
   the chosen id.
7. `sources-field.test.tsx`: the groups dialog shows 50 rows, "Load more"
   shows the next 50, search filters; the 1,000 note only at the cap.

Run the `test-decision` skill before touching any test.

## Deployability gate

### Lane R

- `npm run check:changed` passes (Fallow verdict `pass`).
- `npm run test:acceptance` if Docker on the machine works; otherwise say
  so and rely on the GitHub "Runtime acceptance" check.
- Push; open a PR to `main`; do not merge.

### Lane P

1. `npx tsc --noEmit` clean.
2. `npx vitest run convex/zotero tests/components/evidence-libraries
   tests/components/evidence-library-configuration-workspace.test.tsx` green.
3. `npx convex dev --once` on the lane ends with `Convex functions ready!`;
   `npx convex logs --history 100` shows no matching failure.
4. Browser on the lane's port, signed in as the E2E user: the collections
   dialog opens without a preload and asks the library once, the typed text
   is sent after the pause, and the nav link Collection target opens the
   same dialog. Screenshots in `/tmp/pickers/`. Checked on 2026-08-28: the
   lane's Convex has no library with a running runtime, so the dialog shows
   "Collections appear after the library is set up and has synced" and the
   remote logs show exactly two `listLibraryCollections` calls (open, then
   search) with no failure. Rows, "Load more" and the groups paging are
   proven by the component tests; the runtime end-to-end proof is the
   integration owner's step below, after lane R merges.
5. Push; open a PR to `dev`; do not merge.

### Integration owner, after both merge

1. `npm run convex:push` from `dev-self` → `✔ Convex functions ready!`.
2. Set `EL_RUNTIME_COMMIT_SHA` on the shared deployment to the merged new-el
   commit and publish one library with records from several institutions.
3. On dev.openscholar.ai, open that library's configuration → Institutions →
   Add: search returns from the server, "Load more" pages, pick one; then
   Search & filters → pinned institution the same way. Tear the library down.
4. Outline: one line under the current-state page.

## Completion rules

- Every gate above passes and each PR has been through the Codex review
  (`codex exec -m gpt-5.6-sol -c model_reasoning_effort=high`) with its
  findings applied.
- No list on the configuration page downloads more than one page to show a
  picker. `readCatalogue`, `MAX_PAGES`, the truncated banner and the
  `Popover` institution combobox are deleted.
- Copy follows the page's rules: sentence case, no dots, numbers only when
  they change a decision ("Load more", "3 selected", the 1,000 note).

## Known risks

- Keyset paging on `(count desc, name asc)` needs both columns in the
  cursor; a cursor on count alone skips ties. The test in R1 guards it.
- The runtime read cache (`runtimeReads.ts`) has a freshness window; a
  search must never return a stale page for a different query — the cache
  key includes the query, cursor and sort.
- Until lane R merges, the shared platform's runtime ignores the new
  parameters and answers with the full list; the OpenScholar client must
  treat a response without `nextCursor` as a single page, not fail.

## Files that change

Lane R: `src/app/api/openscholar/institutions/route.ts`,
`src/lib/admin/openscholar-institutions.ts` (+ test), the read-API doc.

Lane P: `convex/zotero/runtimeReadActions.ts`, `runtimeReadClient.ts`,
`runtimeReads.ts`, `libraryGroupActions.ts` (+ tests),
`components/evidence-libraries/configuration/sections/remote-picker-dialog.tsx`
(new), `institution-pickers.tsx`, `collections-field.tsx`, `link-editor.tsx`,
`sources-field.tsx` (+ tests), `messages/*.json`.
