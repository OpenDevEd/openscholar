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

## Zotero connect asks for group write access (recorded 2026-08-26, plan 07)

`startOAuth` now asks Zotero for `all_groups=write` for everyone who connects
a Zotero account in OpenScholar, not only library owners. Write back needs it.
The person can still refuse it on Zotero's consent page. Update the Outline
"Current decisions" page when this merges.

## Remove the runtime's funding partners key (recorded 2026-11-12)

A community's funders are one list now, `footer.funders`. Settings version 15
moves every saved `identity.fundingPartners` entry into it, and OpenScholar no
longer writes that key.

The runtime still reads it. It refuses keys it doesn't know, and nothing stops
a new runtime release reaching a community whose OpenScholar is older than
version 15 and still sends the key. So the runtime shows each partner as a
funder (`fundersOf` in new-el `src/config/library-config/public.ts`).

Next: once production OpenScholar is on version 15 and every running
community's active settings were published from it, delete
`identity.fundingPartners` and `fundersOf` from new-el, then sync the contract
here with `npm run schema:sync:evidence-library-config`.
