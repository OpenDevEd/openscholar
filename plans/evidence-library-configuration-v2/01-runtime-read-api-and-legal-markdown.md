# Plan 01 — Runtime read API and legal Markdown (new-el)

Repository: `OpenDevEd/new-el`, branch off `origin/main` (`c353b55b` or later).
Lane B.

## Goal

Let OpenScholar read a library's collections and institutions with the
library's machine credential, and let owners supply legal page text through
the manifest.

## Scope

1. `GET /api/openscholar/collections?query=&cursor=&pageSize=` — full database
   catalogue (all sources, all states), same data as the admin catalogue
   service (`src/lib/admin/collection-catalog-service.ts`). Returns
   `{ items: [{ id, title, count, source, parentId }], nextCursor }`.
2. `GET /api/openscholar/institutions` — every institution name found on
   records with its record count, from the index or the SQL used by
   `src/app/api/institutions/route.ts` but without the top-country filter.
   Returns `{ items: [{ name, count }] }`.
3. Auth for both: `Authorization: Bearer <authentication.openScholar.machineCredential>`,
   constant-time compare, 401 otherwise. One helper in
   `src/lib/admin/openscholar-bearer.ts`. Never accept the cookie.
4. `legal.privacyMarkdown`, `legal.cookieMarkdown`, `legal.termsMarkdown`:
   optional plain text, max 200 000 characters each, in `schema.ts` next to
   the existing `legal` links. When set, `/privacy`, `/cookie-policy` and a new
   `/terms` page render it through `src/components/pages/PolicyPage.tsx`
   instead of the baked Markdown; `{{SITE_HOST}}` templating still applies.
   `termsOfService` defaults to `/terms` when `termsMarkdown` is set.
5. Regenerate artifacts (`npm run schema:generate:library-config`), update
   `config/library.example.json` and `docs/evidence-library-customization-map.md`.

Out of scope: a validate endpoint, writes, AI, domains.

## Design

- Routes live in `src/app/api/openscholar/{collections,institutions}/route.ts`.
  `Cache-Control: no-store`. Rate limit is not needed: the credential is per
  library and only OpenScholar holds it.
- The bearer helper reads the credential from the loaded config so a config
  change rotates it without a code change.
- Legal Markdown fields are in the public projection (`public.ts`); they are
  not secrets.

## Tests (test-first for pure logic)

- `tests/unit/openscholar-bearer.test.ts`: accepts the exact credential,
  rejects missing, wrong, and cookie-only requests.
- `tests/unit/library-config-schema.test.ts`: Markdown limits, `/terms`
  default when `termsMarkdown` is set.
- Route tests for both endpoints with a seeded database fixture (follow
  `tests/unit/admin-*.test.ts` patterns): paging, search, counts.
- `tests/unit/policy-page.test.tsx`: manifest Markdown wins over the baked file.

## Deployability gate

- `npm run check:changed` (lint, typecheck, schema check, unit tests, Fallow)
  passes. CI green including Runtime acceptance.
- Against a development library: `curl -H "Authorization: Bearer <cred>"
  https://<library>/api/openscholar/institutions` returns 200 with items; a
  wrong bearer returns 401.

## Completion

PR to `main` with the gate output in the body. Then the integration owner
re-pins the OpenScholar contract to the merged commit.

## Risks

- The admin catalogue service may assume a session context; extract the pure
  query part if so.
- Fallow flags new dead exports: export only what the routes use.
