# Plan 12 — Evidence Libraries are switched on per organisation

## Goal

Only organisations the platform team switches on in Clerk can see and use the
Evidence Library owner pages. The switch is one field in the Clerk
organisation's **public metadata**:

```json
{ "evidenceLibraries": true }
```

Anything else — `false`, a string, a number, or the key missing — means off.
There is no environment allowlist. Everything is managed in Clerk.

## Facts checked on 2026-08-27

- The Clerk webhook already projects organisations and memberships into
  Convex: `convex/webhooks/clerk_mappers.ts` builds the snapshots,
  `convex/webhooks/clerk.ts` routes the events, and
  `convex/webhooks/projections.ts` writes the `organizations` and
  `organizationMemberships` rows.
- The snapshot shape lives in `convex/evidenceLibraries/validators.ts`
  (`clerkOrganizationSnapshotFields`, `organizationFields`,
  `clerkMembershipSnapshotFields.organization`). The table is
  `organizations` in `convex/schema.ts:58`.
- Membership events carry a full organisation snapshot
  (`mapMembershipSnapshot` in `clerk_mappers.ts`), and
  `applyMembershipProjection` upserts the organisation from it. So the flag
  must be mapped in both places or a membership event would wipe it.
- Every Evidence Library owner entry point goes through
  `requireOrganizationAccess` in `convex/evidenceLibraries/access.ts`, either
  directly or through `requireEvidenceLibraryAccess`. Checked all 40 call
  sites (`convex/evidenceLibraries/*`, `convex/zotero/*`). Nothing bypasses
  it. This includes create/reserve (`addressActions.reserveAddress` →
  `queries.readAddressCandidates` and `mutations.reserveAddress`), save,
  activate, teardown, versions and address moves, `listLibraryOverviews`,
  and the admin launch.
- The call sites split cleanly by the `action` argument:
  - `"manage"` — create, reserve, save, activate, retry, uploads,
    credentials, deployment, versions, restore, address move, teardown,
    Zotero group writes, and the owner configuration reads
    (`getSetupDraft`, `getDraft`, `getRevision`).
  - `"read"` — `listLibraryOverviews`, `getAdminLaunchState`, `listTeam`,
    `credentials.readIntegrationStatus`, and `adminLoginCodes` (the /admin
    launch for editors of an active library).
- Convex refuses to push a required field when old rows do not have it.
  Verified on the lane deployment `lovable-clownfish-245` on 2026-08-27:

  ```
  ✖ Schema validation failed.
  Document with ID "p57b5h7tesq85022ys3r076b258d6vzn" in table
  "organizations" does not match the schema: Object is missing the required
  field `evidenceLibrariesEnabled`.
  ```

  Convex also validates every write against the deployed schema, so a
  backfill cannot write a field the schema does not declare yet. The only
  order that works without deleting organisation rows (which would orphan the
  evidence libraries that point at them) is: declare the field optional on
  the table, backfill, then a follow-up makes it required.

## Fixed decisions (user)

1. The switch is Clerk organisation public metadata `evidenceLibraries`.
   Strictly `=== true` means on. Everything else means off.
2. Enforcement lives in one place: `requireOrganizationAccess`.
3. **Exception A — existing libraries keep working.** The flag gates the
   owner pages and creation, not the public Evidence Library runtime. The
   runtime has its own routes and does not call this helper.
4. **Exception B — the /admin launch stays open.** `getAdminLaunchState` and
   `adminLoginCodes` are how an editor of an already-active library opens
   `/admin`. They ask for `"read"`, so they are not gated.
5. The refusal is the existing error factory with code `FORBIDDEN` and the
   message "Evidence Libraries are not switched on for this organisation."

## Design

### Projection

`clerkOrganizationSnapshotFields` gains `evidenceLibrariesEnabled:
v.boolean()`. The mapper reads it from the event:

```ts
publicMetadata.evidenceLibraries === true
```

`mapOrganizationSnapshot` is shared by organisation events and membership
events, so both carry the flag.

`organizationFields` overrides the field to `v.optional(v.boolean())`. This
is the one transitional step the Convex schema push forces (see the facts
above). A follow-up change makes it required and deletes the backfill.

`convex/evidenceLibraries/devBackfill.ts` holds
`devBackfillEvidenceLibrariesEnabled`, an internal mutation that sets the
field to `false` on every organisation row that does not have it. It is
development-only and gets deleted in the follow-up.

### Enforcement

`requireOrganizationAccess` refuses when `action === "manage"` and the
organisation row's flag is not `true`. That single rule matches the
exceptions exactly: everything that creates, configures, activates, moves, or
tears down a library asks for `"manage"`; the list, the team, the admin
launch, and the login codes ask for `"read"`.

### Read side for the UI

New query `convex/evidenceLibraries/queries.ts:getEvidenceLibrariesAccess`,
returning `{ enabled: boolean }`. It does not throw: when there is no signed
in user, no active organisation, or no membership, it returns
`{ enabled: false }`. The sidebar renders on every page, so a throwing query
would be wrong there. This is smaller than threading a per-organisation flag
through the per-library `listLibraryOverviews` array validator.

### UI

- `components/app-sidebar.tsx` — the "Evidence Libraries" nav item renders
  only when the query says enabled, matching the existing
  `hasExtractionAccess` pattern.
- `components/evidence-libraries/library-list.tsx` and
  `components/evidence-libraries/new-library-form.tsx` — when the query says
  disabled, show one plain panel instead of the list or the form, reusing
  `AuthStatePanel variant="no_access"` (already used on both pages for the
  "no organisation" case).
- Copy, in all six locales with the two English files identical:
  - heading: "Not available for this organisation"
  - body: "Evidence Libraries are switched on per organisation. Ask the
    OpenScholar team."
- No `useEffect`.

## Tests

Behaviour only (per `docs/test-quality.md` and the `test-decision` skill —
this change adds new behaviour, data, and authorisation, so tests are
required).

1. `convex/webhooks/clerk_mappers.test.ts` — the mapper turns
   `public_metadata.evidenceLibraries` into the flag for `true`, `false`,
   absent, and a garbage value, for both organisation events and membership
   events.
2. `convex/evidenceLibraries/access.test.ts` — `requireOrganizationAccess`
   with `"manage"` refuses with `FORBIDDEN` and the plain message when the
   organisation row is off, and allows it when on; `"read"` is allowed either
   way (the admin-launch exception).
3. `convex/evidenceLibraries/queries.test.ts` (or the existing suite) —
   `getEvidenceLibrariesAccess` returns the flag, and returns
   `{ enabled: false }` with no organisation.
4. `tests/components/evidence-libraries/library-list.test.tsx` and
   `new-form` — the panel heading and body show when disabled; the list and
   the form show when enabled.
5. `tests/components/app-sidebar` — the "Evidence Libraries" nav item is
   absent when disabled and present when enabled.

`e2e/auth.spec.ts` only changes if its texts change. They do not.

## Deployability gate

1. `npx tsc --noEmit` — only the two known errors in
   `components/icons/openalex-icon.tsx`.
2. `npx vitest run convex tests/components/evidence-libraries
   tests/components/evidence-library-configuration-workspace.test.tsx
   lib/evidence-libraries` — green.
3. `npx convex dev --once` on the lane `lovable-clownfish-245` ends with
   `Convex functions ready!`, and `npx convex logs --history 100` has no
   matching failure.
4. Browser check on port 3014 signed in as the E2E user: with the lane
   organisation's row flag `false`, `/evidence-libraries` and
   `/evidence-libraries/new` show the panel and the sidebar has no Evidence
   Libraries item. Flip the row with a dev mutation, reload, and the list and
   the form come back. Screenshots in `/tmp/org-gate/`.
5. The real end-to-end proof, for the integration owner: set
   `{ "evidenceLibraries": true }` on a real organisation in the Clerk
   dashboard and watch the `organizations` row flip through the webhook.

## Steps for the integration owner on the shared deployment

1. Merge this branch into `dev` and run `npm run convex:push` from
   `dev-self`. The push succeeds because the field is optional on the table.
2. Run the backfill once:
   `npx convex run evidenceLibraries/devBackfill:devBackfillEvidenceLibrariesEnabled '{}'`.
   Every organisation row now has `evidenceLibrariesEnabled: false`.
3. In the Clerk dashboard, set public metadata `{ "evidenceLibraries": true }`
   on each organisation that should keep its Evidence Libraries pages. The
   webhook flips the Convex row within seconds.
4. Follow-up change: make `evidenceLibrariesEnabled` required in
   `organizationFields` and delete `convex/evidenceLibraries/devBackfill.ts`.

The end-to-end test `e2e/auth.spec.ts` ("an owner can save and reopen
essential library configuration") creates a library, so the organisation the
E2E user belongs to must be switched on in Clerk before that test can pass.
Its texts do not change, so the spec itself is untouched.

## Known risks

- Between step 1 and step 3 every organisation is off, so owners see the
  panel. Existing libraries keep serving the public and `/admin` keeps
  working, so nothing customer-facing breaks.
- Anyone who edits an organisation in Clerk without the metadata key set will
  get `false` written back. That is the intended behaviour, not a bug.

## Files that change

- `convex/webhooks/clerk_mappers.ts`
- `convex/webhooks/clerk_mappers.test.ts`
- `convex/evidenceLibraries/validators.ts`
- `convex/evidenceLibraries/access.ts`
- `convex/evidenceLibraries/access.test.ts`
- `convex/evidenceLibraries/devBackfill.ts` (new, development only)
- `convex/evidenceLibraries/queries.ts`
- `components/app-sidebar.tsx`
- `components/evidence-libraries/library-list.tsx`
- `components/evidence-libraries/new-library-form.tsx`
- `messages/en-GB.json`, `en-US.json`, `fr.json`, `hi.json`, `ja.json`,
  `zh.json`
- tests under `tests/components/`
