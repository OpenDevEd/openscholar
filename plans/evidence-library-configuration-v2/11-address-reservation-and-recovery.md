# Plan 11 — Address reservation and recovery

## Goal

Reserving a library address must give one truthful answer, never silently
reuse another library, and the platform must recover on its own when an
address turns out to be served by something else — with no special treatment
for our own DNS, so the same rules work for customer domains later.

## Facts checked on 2026-08-27

- `createSetupDraft` reuses an existing provisioning library with the same
  name in the organisation (`setupNaming.ts:146-166`, `mutations.ts:203-209`).
  The preview query ignores that rule and returns `hello-2`; the client shows
  its own guess first. Three answers for one question.
- Uniqueness is checked only in Convex: slug per organisation
  (`by_organizationId_and_slug`) and address globally
  (`evidenceLibraryRuntimeBindings.by_targetBaseUrl`).
- DNS lookups cannot tell a wildcard host from an explicit record on
  Cloudflare (all hosts resolve to the proxy IPs). Do not use DNS.
- An unserved host answers `503` with body `no available server` (our proxy).
  Any other answer means something serves the host. Verified on
  `el-nonexistent-xyz-lib.opendev.space` (503), `outline.opendev.space`
  (200), `docs-mathlib.opendev.space` (307).
- Coolify lists every domain it serves: `GET /api/v1/applications`
  (`fqdn`, `docker_compose_domains`) and `GET /api/v1/services`
  (`applications[].fqdn`). Orphaned library apps appear there.
- After deploy, readiness fetches `/api/library-config/health` and requires
  `active.revision` to equal the published revision
  (`readinessClient.ts:14-33`). This proves the host serves our library.

## Fixed decisions (user)

1. Library names are unique per organisation. No silent reuse. A second
   "hello" is refused with "You already have a library named hello" and a
   link to it.
2. One server answer for the address, shown after "Checking…". The client
   never shows a guessed address.
3. Numbering (`-2`, `-3`) only for real collisions: slug or address taken in
   our database, host listed in Coolify, or host answering anything but the
   free signal.
4. Reserve fails with a plain message when any check cannot run
   ("Could not check the address. Try again.") — never reserve blindly.
5. No Cloudflare or DNS special-casing.
6. When a deploy finds the address served by something else, the platform
   moves the library to the next free address by itself and tells the owner.
7. A live library whose address stops answering as ours shows "Address not
   reachable" and offers "Move to a new address".

## Lane A — reservation (worktree `reserve-sprint`, lane calm-labrador-815)

PR A1 — server:
- `coolifyClient.ts`: `listServedHosts()` reading both endpoints; reuse
  `requestCoolify`, parse `fqdn` and `docker_compose_domains`.
- New `"use node"` action `evidenceLibraries/addressActions.ts`:
  `checkAddress({ name })` → `{ status: "available", shortName, slug,
  publicAddress } | { status: "name-taken", libraryId } |
  { status: "unavailable", reason }` and `reserveAddress({ name })`.
  Order: name unique in organisation (any state except disabled/deleted) →
  candidate loop: database (existing `findAvailable…` split into a pure
  candidate step plus checks) → Coolify hosts → HTTP probe
  (`GET https://<host>/`, free only when status 503 and body starts with
  `no available server`; 15 s timeout; any network failure = check failed).
  `reserveAddress` then calls an internal mutation that re-runs the database
  checks in its transaction and creates the records (existing
  `createEvidenceLibrarySetup`), returning the setup result.
- Delete the same-name reuse and the public `createSetupDraft`/
  `previewSetupIdentity` paths (breaking change; update tests and fixtures).
- Tests: name-taken, each collision kind, probe signatures, check failure,
  transaction re-check.

PR A2 — new page:
- `new-library-form.tsx` uses `checkAddress` (debounced 300 ms) and
  `reserveAddress`. Short name stays derived instantly; the address field
  shows "Checking…" until the action answers, then the exact address.
  `name-taken` shows the message with a link to the existing library and
  disables Reserve. Check failure shows the message with "Try again".
- Six locales; component tests for each state.

## Lane B — recovery (worktree `recovery-sprint`, lane lovable-clownfish-245)

PR B1 — detect and re-address at deploy:
- Readiness: distinguish "not ours" (host answers but not `/api/library-config/health`
  with our revision after the app is healthy in Coolify) from "not ready yet".
  New error code `ADDRESS_NOT_OURS`.
- New operation step "re-address": pick the next free address with lane A's
  candidate rules (until A1 merges, use the database rule; then rebase and
  call the shared check), update the runtime binding `targetBaseUrl`, the
  identity `baseUrl`, the Coolify compose domain, redeploy, re-run
  readiness. Record the old and new address on the operation.
- Tests with the fake Coolify and a fake host prober.

Revised 2026-08-27 while building B1:
- The move happens on the server while nobody clicked anything, so there is
  no action to fire a toast from and an effect that watches the query is
  banned. The list row carries the fact instead: "Moved to <new address>",
  shown while the library is still setting up. The toast belongs to the
  manual move in B2, where a click starts it.
- New files, so lanes A and C keep their write-sets: candidate walk and the
  move itself in `convex/evidenceLibraries/addressRecovery.ts`, the list
  query in `convex/evidenceLibraries/updates.ts`, and a development-only
  seeding mutation in `convex/testing/evidenceLibraryAddresses.ts` (no test
  deployment can make a real host answer as another site).
- `queries.ts` stays lane A's: the list reads the notice from a second query
  in `updates.ts` instead of a new field on the overview.

PR B2 — live libraries:
- The existing update check (`updates.ts`) also runs the ownership check per
  live library and stores `addressState: "ours" | "not-ours" | "unreachable"`
  on the binding.
- List row and Versions panel show "Address not reachable" with a button
  "Move to a new address" → same re-address operation.
- Tests: state stored, button runs the operation, disabled while running.

Revised 2026-08-27 while building B2:
- The pages read the stored `addressState` through a query, not the update
  check's answer. A GitHub outage makes the software check fail, and the
  address warning must survive that. `updates.check` writes the row; the row
  is what the list and the Versions panel show, so a finished move clears the
  warning by itself.
- A live library moves by publishing its live revision again at the new
  address: the binding, the draft and the revision take the address, the
  operation carries `addressMove`, and the publish pipeline changes the
  Coolify compose domain first (`setApplicationDomain`, next to the existing
  `setApplicationCommit`) before the normal deploy and readiness run.
- Files outside the first write-set, all additions: `operations.ts` gains
  `queueAddressMoveOperation`, `coolifyClient.ts` gains
  `setApplicationDomain`. Neither is a function lane A owns.

## Migration

None. Existing drafts keep their addresses. The public `createSetupDraft`
mutation is removed; the new page is the only caller.

## Deployability gates

Lane uploads and browser checks per PR. After merge, on the shared
deployment: reserve "hello" twice (second refused with link); reserve a name
whose `<slug>-lib` host is really served (a leftover library app in Coolify,
for example `E2E Library 1787622331198`; `outline` does not work because
`outline-lib.opendev.space` is unserved) and see `-2`; deploy one `el-*` library; stop
Coolify serving its host (rename the compose domain by hand in Coolify) and
run the update check to see "Address not reachable" and move it; tear down.

## Completion

All seven decisions live on dev.openscholar.ai and shown to the user.
