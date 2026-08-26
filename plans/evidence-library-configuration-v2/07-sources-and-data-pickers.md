# Plan 07 — Zotero sources, Collections, Institutions pickers (OpenScholar)

Lane B (after plan 01 merges and the contract is re-pinned), after plan 02.

## Goal

Owners connect Zotero groups with their own Zotero account; Collections and
Institutions pickers read the library's real data.

## Scope

1. Table `evidenceLibraryZoteroGroups`: `libraryId`, `groupId`, `name`,
   `isPublic`, `connectedByClerkUserId`, `connectedByZoteroUsername`,
   `connectedAt`, `scopes: { read, write }`, `credentialKey`. The `sources`
   draft section stores the schema shape without the key:
   `{ key: "zotero-<groupId>", provider: "zotero", groupId, enabled,
   writebackEnabled }` per group; names, scopes and who-connected come from
   this table; the key is a library credential `zotero-group:<groupId>`
   (encrypted copy of the owner's key, see `convex/zotero/internal.ts` for
   the source).

   Revised 2026-08-26: the pinned section validator marks `sources[].apiKey`
   as required, and drafts may never carry credentials
   (`assertNoCredentialMaterial`). Draft validation therefore skips
   "required" issues for write-only paths (`owner-rules.ts`); the full
   validator at assembly still requires the key, which the hook injects.
   The existing OAuth start asks Zotero for `all_groups=read`, so no owner
   key could ever carry group write access; `startOAuth` now asks for
   `all_groups=write` (the owner can still refuse on the Zotero consent
   page). `startOAuth` also accepts an optional `returnTo` path so the
   owner comes back to the configuration page after connecting.
2. Actions: `listMyZoteroGroups({ libraryId })` (owner's connection →
   `fetchGroups`, marks already-added), `connectZoteroGroup({ libraryId, groupId })`
   (checks `keys/current` for `library` and `write` on that group, stores
   credential + row), `reconnectZoteroGroup`, `removeZoteroGroup`. Owners
   without a Zotero connection get the existing OAuth start URL.
3. Assembly hook (plan 02's `applySourceCredentials`): for each group row,
   emit a `sources[]` entry `{ key: "zotero-<groupId>", provider: "zotero",
   groupId, apiKey, enabled, writebackEnabled }` with the decrypted credential
   at deploy time only.
4. Queries against the runtime through the library's machine credential (the
   credential stored as `library-service`): `listLibraryCollections({ libraryId, query, cursor })`
   and `listRecordInstitutions({ libraryId })` call plan 01's endpoints on
   `runtimeBinding.targetBaseUrl`. Cached five minutes in a table. Draft
   libraries (no binding) return empty lists with `reason: "not-set-up"`.

   Revised 2026-08-26: the runtime reads `cursor`, `pageSize` and `query`
   (no `limit`) and answers `{ items: [{ id, title, parentId, source, count }],
   nextCursor }` for collections and `{ items: [{ name, count }] }` for
   institutions. A library counts as set up when
   `readEvidenceLibraryAdminLaunchTarget` returns its address.
5. Page sections (owned by this lane): Sources (account line "Connected as
   <handle>" from the current owner's connection, groups picker, rows with
   health, public/private, records, last sync, Write back, Pause = `enabled`,
   Remove; Advanced tag rules → `content.tags`), Collections (picker dialog
   → `collections[]` with order + title override), Institutions name picker
   and the featured-institution picker (hand these two components to lane C
   through a small shared module).

   Revised 2026-08-26: the pinned contract keeps the featured institution
   at `filters.institution.featuredValue` (mode
   `facet-with-featured-value`), not under `search`. Plan 05 has not merged,
   so the sections are exported as field bodies with `{ value, onChange }`
   props from `components/evidence-libraries/configuration/sections/` and
   use their own small controls in that folder; lane C wraps them in its
   section shell. Files outside the lane B write-set that this plan must
   touch, each with the smallest change: `convex/schema.ts` (two tables),
   `convex/evidenceLibraries/configurationDeployment.ts` (return group
   credentials from `prepareConfigurationDeployment`),
   `convex/evidenceLibraries/runtimeConfiguration.ts` (pass the hook),
   `lib/evidence-libraries/configuration/owner-rules.ts` (write-only
   required rule), `convex/http.ts` (OAuth `returnTo`), and a new
   `evidenceLibrarySources` namespace in `messages/*.json`.
6. Sync status: the runtime has no endpoint for last sync yet; show the
   `sources[]` presence and `enabled` state only, and record a follow-up in
   `docs/` for a status endpoint.

## Tests

- Pure: `keys/current` scope parsing; group → `sources[]` mapping;
  content tag rules validity.
- Convex behaviour: connect stores an encrypted credential and scopes; a key
  without write scope yields `writebackEnabled` disabled with reason;
  assembly injects the key only in the deploy action (drafts never contain it).
- Runtime read queries: HTTP mocked; cache expiry; not-set-up state.

## Deployability gate

`npx convex dev --once` on lane B; with a development library (created and
torn down by this lane): connect a real group through the OAuth-connected
account, activate, and confirm the library's `/api/admin/library` shows the
source and the search index fills. Collections picker lists the real
catalogue through the new endpoint.

## Completion

PR to `dev`. Remove any development library this plan created.
