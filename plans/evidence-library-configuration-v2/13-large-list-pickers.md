# Plan 13 · Large list pickers

Written on 2026-08-28 by the runtime lane (lane R) because the sprint started
lane R and lane P against a contract that had no plan file. This file records
the contract both lanes build against.

## The problem

`GET /api/openscholar/institutions` returns every institution name in one
array. A library with tens of thousands of records can name thousands of
institutions, so the picker in OpenScholar waits for one huge response and has
no way to search. The collections endpoint next to it already pages.

## Two lanes

| Lane | Repository | Owns |
|---|---|---|
| R · Runtime | `OpenDevEd/new-el`, branch `codex/institutions-paging` | `src/lib/admin/openscholar-institutions.ts`, its new contract file, `src/app/api/openscholar/institutions/route.ts`, the matching tests, `docs/evidence-library-customization-map.md` |
| P · Picker | OpenScholar | the configuration picker that reads the endpoint |

Lane P builds against the contract below while lane R implements it.

## The contract

`GET /api/openscholar/institutions`

Authentication: bearer token, the library's machine credential. Same guard as
the collections endpoint (`requireOpenScholarBearer`).

Parameters, all optional:

1. `query` — case-insensitive "contains" match on the institution name.
2. `cursor` — the `nextCursor` from the previous page.
3. `pageSize` — 1 to 200. Default 50. A larger number is reduced to 200.
4. `sort` — `count` (default) or `name`.

Response: `{ "items": [{ "name": "...", "count": 12 }], "nextCursor": "..." }`.
`nextCursor` is `null` on the last page.

Errors use the existing admin error shape. A cursor that cannot be read, or
that belongs to a different search or sort, returns 400 with
`{ error: { code: "validation_error", message, fields } }`.

## Fixed decisions

1. Keyset paging, no `OFFSET`. Default order is count high to low, then name
   A to Z. `sort=name` orders by name only. The cursor carries both the count
   and the name so rows with the same count never repeat or go missing.
2. The cursor is opaque: base64url JSON with a version, the count, the name,
   the lower-cased query and the sort. It is checked against the request.
3. No request without parameters returns everything. It returns the first page.
   The old "one array" response is deleted, not kept beside the new one.
4. `pageSize` above the cap is reduced to the cap rather than refused. This is
   the one place lane R does not copy the collections contract, which refuses a
   page size above its cap. A picker that asks for too much should get a full
   page, not an error.
5. Same file layout as collections: a contract file for parsing, encoding and
   decoding; a service file that builds and runs the query; a thin route.

## Test-first steps

1. Red → green on the contract and the service, using the existing
   "compile the query and check the SQL" pattern from
   `tests/unit/library-export-query.test.ts` and
   `tests/unit/admin-item-list-query.test.ts`:
   - the first page asks for one row more than the page size and has no
     `OFFSET`;
   - `query` becomes a case-insensitive contains match and `%`, `_` and `\`
     are treated as ordinary characters;
   - `sort=name` changes the order;
   - a cursor adds the "after this count and name" condition, including the
     tie-break on name;
   - a page size above the cap becomes the cap and a missing one becomes 50;
   - a cursor from a different query or sort is refused;
   - no rows gives `{ items: [], nextCursor: null }`;
   - a full page with more rows behind it returns a cursor, the last page
     returns `null`.
2. Red → green on the route in `tests/unit/openscholar-routes.test.ts`: the
   wrong bearer is refused before the database is touched, the parameters
   reach the service, the body has the agreed shape, and a broken cursor
   returns 400.
3. Update the runtime acceptance check
   (`verifyOpenScholarReadApi` in `tools/runRuntimeAcceptance.ts`) so it reads
   the institutions endpoint one row at a time, follows the cursor, proves the
   two pages do not repeat a name, and proves the search filter works.
4. Update the OpenScholar read API row in
   `docs/evidence-library-customization-map.md`.

## Files that change

- `src/lib/admin/institution-catalog-contract.ts` (new)
- `src/lib/admin/openscholar-institutions.ts`
- `src/app/api/openscholar/institutions/route.ts`
- `tests/unit/openscholar-institution-catalog.test.ts` (new)
- `tests/unit/openscholar-routes.test.ts`
- `tools/runRuntimeAcceptance.ts`
- `docs/evidence-library-customization-map.md`

## Migration

None. The endpoint is only read by the OpenScholar configuration pickers,
which lane P is writing now.

## Deployability gate

- `npm run check:changed` in the new-el worktree passes, including Fallow.
- `npm run test:acceptance` runs the runtime acceptance stack and the
  OpenScholar read API check passes. If Docker is unavailable on the machine,
  say so in the pull request and rely on the GitHub "Runtime acceptance" check.

## Completion rules

Both checks above pass, the pull request is open against `main`, and no
acceptance containers are left running.

## Risks

- Counting institutions is an aggregate over a lateral join. The keyset
  condition has to sit in `HAVING`, not `WHERE`. The tests compile the query so
  this stays visible.
- Two institutions with the same count and the same name would collide, but the
  name is the group key, so names are unique in the result.
