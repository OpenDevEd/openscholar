# Evidence Library follow-ups

Small pieces of work the Evidence Library runtime (`OpenDevEd/new-el`) still
needs so the OpenScholar configuration page can show everything owners ask for.

## Sync status for each source (recorded 2026-08-26, plan 07)

The Sources section shows each connected Zotero group with its `enabled`
state and whether the owner's key can write to it. It cannot show the last
sync time or record count from the runtime, because the runtime has no
endpoint for that yet.

Next: add `GET /api/openscholar/sources` to the runtime (bearer = the
library's machine credential) answering
`{ items: [{ key, lastSyncedAt, recordCount, lastError }] }`, then show those
facts on each source row in
`components/evidence-libraries/configuration/sections/sources-field.tsx`.
