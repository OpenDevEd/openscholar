# Plan 18 — Production configuration evolution

## Goal

Every saved Evidence Library configuration has an explicit OpenScholar format
version. Any future field rename, removal, type change, default change,
ownership change, section move, split or merge must supply a tested migration
from the previous version. OpenScholar audits every stored snapshot before a
release, refuses unknown or ambiguous data, and deploys a new migrated revision
before it changes what a live library uses.

This replaces the first Plan 18 draft. The user confirmed on 2026-08-29 that
production is now. Evidence Library configuration data is not disposable.

## The failure that exposed the gap

`new lib` is healthy on runtime `95ac3fc0`. Its update to `937bb65e` failed
before Coolify ran. Active revision `r2` stores:

- `/features/aiSearch`
- `/features/deepResearch`

Plan 15 moved both values from owner control to platform control. The runtime
schema stayed compatible, so its `schemaVersion` did not change. OpenScholar
then applied the new ownership rule to the old unversioned revision and refused
it. Retry reused the same revision and failed again.

The two fields are the first migration, not the migration system.

## Facts checked on 2026-08-29

- `contractProvenance.schemaVersion` describes the pinned Evidence Library
  runtime contract. It does not describe OpenScholar's saved owner format.
- Draft and revision headers are the complete-snapshot boundaries. Section rows
  belong to one header through `draftId` or `revisionId`.
- Initial setup creates a header-only `r1` revision. It is historical setup
  metadata, has no section rows and is never deployable. The first activation
  creates the first complete revision.
- The shared deployment currently has 5 libraries, 5 drafts, 7 revisions, 78
  section rows and 7 configuration operations. These counts are small today,
  but the production mechanism must remain bounded as they grow.
- `@convex-dev/migrations` is not installed. Convex's current official guidance
  says to use the migrations component for live data because it supplies
  batching, dry runs, progress, resume and cancellation.
- The existing deployment pipeline changes `activeRevisionId` only after
  Coolify finishes and the health check succeeds. Migration deployments must
  keep that guarantee.
- New owner writes already reject credential material and platform-owned
  values. Migrations must not weaken that boundary.

## Fixed decisions

1. **A separate snapshot version.** Add `ownerConfigurationVersion` to every
   draft and revision header. Do not reuse runtime `schemaVersion`.
2. **One source of truth.** Do not repeat the version on section rows or
   operations. A draft or revision header owns the complete snapshot. A saved
   deployment target is valid only when its operation points to a
   current-version revision.
3. **Version 1 and version 2.** Version 1 means every known existing
   unversioned owner shape. Version 2 is the current owner-only format.
   Migration `1 -> 2` removes `features.aiSearch` and
   `features.deepResearch`; assembly derives them from platform policy. It
   also converts pre-`122a7e55` Exports file-address values to the same schema
   defaults used by the existing `readDraft` and `rowPayload` path. It
   preserves every remaining owner value.
4. **One ordered migration registry.** Add
   `owner-configuration-migrations.ts` beside the owner rules. It receives the
   complete snapshot and applies explicit consecutive steps until it reaches
   `CURRENT_OWNER_CONFIGURATION_VERSION`.
5. **No guessing.** The runner rejects missing versions outside the temporary
   production backfill, versions newer than this code, missing steps,
   duplicate sections, unknown sections, invalid output, credential material
   and values a migration cannot interpret without a product decision.
6. **Full-snapshot changes.** A migration step may rename or remove fields,
   change types or defaults, transfer ownership, and merge, split or move
   sections. Each step contains the exact decision for that change. The runner
   never deletes fields merely because they look platform-owned.
7. **Frozen history stays frozen.** The first backfill labels historical
   revisions as version 1 without changing their payloads. Restore migrates the
   selected snapshot and creates a new current-version revision. The source
   remains unchanged and visible.
8. **Live libraries use migrated candidates.** Runtime update, configuration
   publish, address move and domain change create one current-version candidate
   revision before queueing Coolify. No background job rebuilds every library
   merely to change its stored format. Each library migrates through its next
   real operation. The old active revision stays live until readiness succeeds.
9. **Retries reuse the candidate.** Candidate creation and operation creation
   share one transaction. The idempotency key covers the library, source
   revision, target configuration version and the operation-specific intent,
   such as the requested runtime commit or address generation. Network,
   Coolify and readiness retries reuse that exact candidate. A migration
   failure happens before external calls and carries safe issues.
10. **Use the official migration component.** Pin
    `@convex-dev/migrations@0.3.3`. The shared self-hosted backend is commit
    `a9a760ca10399ed42e1b4bb87c78539a235488c7` from 2026-03-24. Component
    `0.3.4` and newer use the later `1.0/getFunctionMetadata` backend syscall
    for direct CLI runs, so they cannot run here. Version `0.3.3` uses the
    official explicit runner and supports this backend. Use it for the version
    backfill, mutable draft migration and status tracking. Do not build another
    cursor, progress or resume framework. Upgrade the backend separately; do
    not mix a database-server upgrade into this configuration rollout.
11. **Widen, tag, teach, migrate, narrow.** The first deployment adds the
    optional field while ordinary code keeps version-1 behavior and writes
    version 1. The migration component tags every missing header as version 1.
    Only after zero headers are missing does the second deployment require a
    version, add the migration-aware read paths and write version 2. After
    drafts migrate and the live gates prove version-1 active revisions create
    current candidates on their next real operation, the third deployment
    accepts only version 2 for mutable drafts. No ordinary read ever guesses a
    missing version. Keep explicit historical migrations for Restore.
12. **Production release rule.** Any change to stored meaning or ownership
    increments the current version and adds one explicit migration step before
    stricter rules deploy. Audit all drafts and revisions, migrate mutable data,
    prove the historical chain and live operations, then narrow. A failed audit
    blocks the release.

## Data model

Add this snapshot-level field:

```ts
ownerConfigurationVersion: 1 | 2
```

During Deploy A it is optional on:

- `evidenceLibraryConfigDrafts`
- `evidenceLibraryConfigRevisions`

Deploy B requires the known-version union on both headers. Historical revisions
may keep an older known version. Deploy C accepts only the current version on
mutable drafts; revisions keep the union of supported historical versions.
Every revision created after Deploy B uses the current version. Any candidate
that later becomes active is therefore current. A revision that was already
active may remain at a supported historical version until its next real
operation.

Add indexes on the two header tables by `ownerConfigurationVersion` for bounded
verification. Do not add the field to `evidenceLibraryConfigSections`.

An operation that deploys a migrated candidate keeps its existing `revisionId`.
Do not add another version or migration object to the operation. The candidate
revision records its version and `basedOnRevisionId`; that lineage is enough
for Versions, audit and support tools to explain the event.

## Migration contract

The pure module owns:

```ts
type OwnerConfigurationSnapshot = {
  ownerConfigurationVersion: number;
  sections: OwnerSectionRow[];
};

type OwnerConfigurationMigration = {
  from: number;
  to: number;
  migrate(snapshot: OwnerConfigurationSnapshot): OwnerConfigurationSnapshot;
};
```

`migrateOwnerConfiguration(snapshot)`:

1. Refuses an invalid, unsupported future or unsupported old version.
2. Finds the exact `N -> N + 1` step. A gap is an error.
3. Runs steps over the complete snapshot without mutating the input.
4. Validates unique section keys, credential exclusion, section byte limits and
   total size. Mutable drafts use the same incomplete-draft rules as Save
   (`requireComplete: false`). Revisions and deployment candidates use the
   complete activation and deployment rules.
5. Returns the current snapshot and a bounded list of changed JSON pointers for
   audit logs. It never logs values.

Version 1 to 2 has three explicit decisions:

1. Delete the two former owner switches from the Features row.
2. When any Exports value is not a boolean, replace the Exports row with the
   three current schema-default booleans. This is the existing
   pre-`122a7e55` rule, not a guess based on the stored file addresses.
3. When Identity has no `assets` object, add `assets: {}`. Version-1 setup
   stored only `name`, `shortName` and `baseUrl`; the current schema requires
   the container while each asset remains optional and platform branding fills
   omitted values during assembly. Preserve every existing Identity field and
   every existing asset. An invalid non-object `assets` value still fails.

The read-only audit reports both shapes separately before writes. If both old
and replacement representations ever exist in a future migration, that
migration declares collision behavior or fails.

Every later change follows the same contract:

| Change | Required migration decision |
|---|---|
| Add a stored field | Set the exact value or prove the field is optional and has no stored meaning |
| Rename or move a field | Copy the value to its named destination, then remove the old field |
| Remove a field | State why the value is no longer owned or used, then remove only that field |
| Change a type or allowed value | Define a total conversion or reject the ambiguous records |
| Change a default | Decide whether old snapshots keep the old result or receive the new result |
| Transfer ownership | Move the value to its new owner or remove it only when that owner derives it |
| Split, merge or move sections | Transform the complete snapshot so cross-section rules can be checked |

Schema diffs can identify that something changed, but they cannot decide what
old data means. The release author must make that decision in the next explicit
`N -> N + 1` step and its tests.

Secrets stay outside this generic module. A future change that moves a secret
between stores gets a dedicated migration with encrypted-value fingerprints.
The snapshot runner must never read, decrypt, copy or log a credential.

## Shared database seam

Add `convex/evidenceLibraries/configurationSnapshot.ts` as the only module that
loads a draft or revision header with all its section rows and asks the pure
registry for a current snapshot.

Reuse it in:

- draft save and activation in `mutations.ts`;
- initial and retried setup in `applicationSetup.ts`;
- runtime update, restore, address move and domain deployment in `versions.ts`;
- deployment preparation in `configurationDeployment.ts`;
- configuration reads in `queries.ts`, `revisionConfiguration.ts`,
  `databaseSetup.ts` and `setupNaming.ts`;
- address recovery reads in `addressRecovery.ts`; and
- revision fingerprint reads in `versions.ts` when Versions compares payloads.

This rule covers every read that interprets section payloads. A query that only
counts rows or reads header metadata does not need to reconstruct a snapshot.

New request payloads still go straight through strict current validation. Only
trusted snapshots read from Convex enter the migration registry.

## Operation behavior

### Draft save and activation

- Load and migrate the complete draft inside the mutation.
- When migration changes the header version, persist every section whose
  migrated payload differs from storage in the same transaction. Never stamp a
  current version over old section rows.
- Merge the owner's changed rows only after migration.
- Check the existing `editVersion` before writing. A concurrent owner edit gets
  the existing stale-edit conflict; migration never overwrites it.
- Write the current version and recomputed byte lengths in the same transaction.
- Activation copies only the persisted current-version rows. It never relies
  on an in-memory transformation that Save did not store.
- A background draft migration does not bump `editVersion`. An open editor
  already reads the migrated shape; a later Save merges its changed cards over
  the current snapshot. Current request validation rejects a stale payload
  shape instead of overwriting migrated data.
- Finalize only a current-version draft into a current-version revision.

### Runtime update, address and domain changes

- Load the active revision and migrate it in memory.
- If it is already current, use it.
- If it is old, create one current-version candidate revision with
  `basedOnRevisionId` set to the active source.
- Look up the operation by the full idempotency key before creating anything.
  If it exists, reuse its `revisionId`. Create a candidate only when no matching
  operation exists, then insert candidate and operation in one transaction.
- The key includes the source revision ID, target configuration version and
  requested runtime, address or domain intent.
- For Restore, the key includes both the active revision at request time and
  the selected historical revision. Restoring the same source after a later
  activation is a new command; repeating the same command is not.
- Address and domain candidates contain their new `identity.baseUrl` before
  deployment. After readiness, update the runtime binding, mutable draft and
  domain records, but never patch the candidate or source revision payload.
- Never change `activeRevisionId` here.

### Deployment and retry

- `prepareConfigurationDeployment` requires the operation's revision to be
  current before it assembles or contacts Coolify.
- A saved target whose revision is no longer acceptable is refused before an
  external call.
- Retry never reruns a migration. It reuses the operation's immutable current
  candidate and saved target.
- A failed old-format operation, including the current failed `new lib`
  operation, stays as history. The server projects `retryable: false` because
  its revision is not current. The migration-aware update creates a new
  version-2 candidate and a new operation. It never changes the old operation
  to point somewhere else.
- The server, not the component, decides `retryable`. It is true only for a
  failed operation with a saved target when all of these remain true: its
  revision is the current owner format, the operation is still the library's
  newest configuration-deployment command, the revision is either active or a
  candidate based on the active revision, and its saved runtime intent still
  matches the ready binding. A missing target is not retryable. Do not use
  `latestRevisionId` as the command-order test: a later current-format runtime
  update may reuse the active revision after an earlier candidate failed.
- The fail-closed transient list is
  `CONFIGURATION_DEPLOYMENT_STALLED`, `COOLIFY_UNAVAILABLE`,
  `READINESS_UNAVAILABLE`, `RUNTIME_NOT_READY`, `CONFIG_NOT_READY` and
  `PAGE_NOT_READY`. Unknown codes and every other code are not retryable.
  `COOLIFY_DEPLOYMENT_FAILED` and `COOLIFY_DEPLOYMENT_NOT_FINISHED` stay out
  until a later plan defines and tests a bounded repeated-build policy.
- The retry mutation enforces the same shared predicate as the query
  projection. An expired running lease is recovered by the existing internal
  watchdog, not by the owner's failed-operation Retry action.
- `completeConfigurationDeployment` remains the only place that changes
  `activeRevisionId`, after readiness succeeds.
- A failed deployment leaves the old revision live.

### Restore

- Load the selected historical snapshot at its recorded version.
- Run the complete migration chain and current validation.
- Create a new current-version revision and draft.
- Keep `rollbackOfRevisionId` pointing to the historical source.
- If no migration path exists, show that the version cannot be restored. Never
  return a raw old payload to the current editor as if it were current.

## Work lanes

Large work is parallel only where write sets are independent.

| Phase | Lane | Owns |
|---|---|---|
| 1 | M, migration foundation | `package*.json`, `convex/convex.config.ts`, schema and validators, `owner-configuration-migrations.ts`, `configurationSnapshot.ts`, audit and version-tag migration definitions, generated Convex API types, header metadata in the manual `queries.ts` return projections, and their tests |
| 1 | Integration owner | Merge M, push Deploy A, tag all missing headers, and verify zero missing versions |
| 2 | R, runtime wiring | Deploy B code in `mutations.ts`, `applicationSetup.ts`, `versions.ts`, `addressRecovery.ts`, the mutable-draft migration definition, payload-reading helpers outside `queries.ts` and their integration tests |
| 2 | E, deployment recovery | `configurationDeployment.ts`, its orchestration in `configurationDeploymentActions.ts`, `operations.ts`, all Deploy B changes in `queries.ts`, server-owned `retryable` projection and enforcement, workspace Retry behavior and their tests |
| 3 | Integration owner | Review R and E once, merge both, push Deploy B, migrate drafts, run live gates, then commit and push Deploy C narrowing and update Outline |

Lane M must finish first because Deploy A creates the version contract. After
Deploy A tags every header, lanes R and E run together in separate worktrees and
Convex Cloud deployments. Lane E owns the whole deployment file because the
retry mutation and the pre-Coolify current-version check share its private
claim and target helpers. It also owns the paired action orchestrator because
the address move must leave the live binding untouched until readiness instead
of applying it between preparation and deployment. Splitting those paths would
make the lanes overlap.
Their write sets therefore do not overlap. Neither may merge before the shared
tag audit is green. All Codex agents use GPT-5.6 Luna at max reasoning and read
`ponytail` and `unslop`. Fable-5 reviews once at the end of each phase.

## Test decision

Test change: yes. This changes production data, snapshot interpretation,
deployment targets and active-revision transitions.

1. The changed contract is that every stored snapshot has a known format and
   every deployment uses a current-format revision.
2. Tests catch silent field loss, incomplete migration chains, stale edit
   overwrites, repeated candidates, deployment of old data and early live
   pointer changes.
3. Existing tests seed only current rows and therefore missed the Plan 15
   ownership change.
4. The smallest honest boundaries are the pure migration return value, Convex
   rows and operations, and the deployed health result.
5. Tests assert versions, row payloads, ids, states, pointers and responses.
   They do not assert classes or ordinary copy.

### Exact tests

- New
  `lib/evidence-libraries/configuration/owner-configuration-migrations.test.ts`:
  `1 -> 2`, missing Identity assets becomes an empty object while existing
  assets stay unchanged, chained steps,
  complete-snapshot section moves, collision failure, input immutability,
  deterministic output, current no-op, missing step, unknown old and newer
  versions, invalid output and credential-bearing output.
- New `convex/evidenceLibraries/configurationMigration.test.ts`:
  tagging a missing header, no-op on a tagged header, reporting a header-only
  setup revision separately without a validation failure, and refusing an
  unknown version. Do not retest the component's own progress, resume or index
  code.
- `convex/evidenceLibraries/drafts.test.ts`: saving and activating a version-1
  draft produces only current rows and a current revision; the Deploy B
  `migrateDraftsToV2` definition rewrites one draft atomically without changing
  `editVersion`.
- `convex/evidenceLibraries/versions.test.ts`: runtime update, address move,
  domain change and restore each create or reuse one current candidate; old
  revisions stay unchanged; a repeated command looks up the operation before
  candidate creation; replacing an old failed update creates one new candidate
  and operation.
- `convex/evidenceLibraries/configurationDeployment.test.ts`: no Coolify call
  for an old or stale candidate; a failed current candidate with an allowlisted
  transient code reuses its saved target, while a missing target, unknown code,
  later deployment command, changed active source or changed runtime intent blocks
  Retry; completion alone switches the active revision; the runtime hash comes
  from migrated data.
- `convex/evidenceLibraries/applicationSetup.test.ts`,
  `convex/evidenceLibraries/databaseSetup.test.ts`,
  `convex/evidenceLibraries/setup.test.ts` and the existing query coverage in
  `convex/evidenceLibraries/drafts.test.ts`: each reads through the shared
  snapshot seam and refuses unsupported versions.
- `tests/components/evidence-library-configuration-workspace.test.tsx`:
  server-projected non-retryable failures have no Retry action; retryable
  transient failures do.

## Production rollout

### Deploy A: widen and tag

1. Run `npm install --save-exact @convex-dev/migrations@0.3.3`, mount it in
   `convex/convex.config.ts`, and export `migrations.runner()` as `run` from
   `convex/migrations/ownerConfiguration.ts`.
2. Add optional header versions and indexes. Keep ordinary version-1 behavior.
   Every newly created or rewritten header records version 1.
   Include the optional version in every manual draft and revision return
   validator so Convex does not strip the stored header metadata.
3. Add the pure registry, read-only audit and the two version-tag migration
   definitions, but do not add the version-2 draft writer or route normal
   application reads through the registry yet.
4. Upload from `dev-self` with `npm run convex:push`; require
   `Convex functions ready!`.

### Audit and dry-run

1. Export a Convex snapshot before writes:

   ```sh
   owner_config_backup_dir="$(mktemp -d)"
   npx convex export --path "$owner_config_backup_dir/openscholar-before-owner-config-v2.zip"
   ```
2. Run a paginated read-only audit over every draft and revision. Report
   counts, versions, old Features switches, non-boolean Exports rows and a
   bounded sample of failures. Never use an unbounded `.collect()`.
3. Dry-run the version backfills and the `1 -> 2` snapshot chain through the
   migrations component.
4. Backfill every missing draft and revision header to version 1. Verify zero
   missing versions before Deploy B.
5. Rerun every audit page after the backfill. Require zero migration-validation
   failures before Deploy B. Count header-only setup revisions separately.
6. Stop on an unknown version, missing parent, duplicate section, migration
   error, credential value, size failure or current validation failure.

The implementation defines these exact entry points:

- `evidenceLibraries/configurationMigration:auditPage` for the paginated,
  read-only report;
- `migrations/ownerConfiguration:run` as the official component runner;
- `migrations/ownerConfiguration:tagDraftVersions` and
  `migrations/ownerConfiguration:tagRevisionVersions` as the two migration
  functions passed to that runner.

Run each migration through `run` with its full function name and `dryRun: true`
first. For example:

```sh
npx convex run migrations/ownerConfiguration:run \
  '{"fn":"migrations/ownerConfiguration:tagDraftVersions","dryRun":true}'
```

During a write run, omit `dryRun` and watch
`npx convex run --component migrations lib:getStatus --watch` until the named
migration is complete. Repeat `auditPage` with the returned cursor until
`isDone` is true.

### Deploy A proof — 2026-08-29

- Merged PRs #122, #123 and #124. Shared `dev` was
  `e8872d1177f1596b939c31a6581c8177474fe214` for the final audit.
- Exported a 5.5 MB snapshot before writes to
  `/var/folders/hz/n4vcv2ld2zv67svmsrzy0kg80000gn/T/tmp.5nunapTE1O/openscholar-before-owner-config-v2.zip`.
- Each shared upload ended with `Convex functions ready!`. The runtime contract
  stayed pinned to `937bb65ecb30f5f6f22cde5d0d527f3ad9988987`.
- The first component dry-run exposed that migrations `0.3.4+` require a
  backend syscall absent from the shared March 24 backend. No row changed.
  PR #123 pinned official migrations `0.3.3` and its explicit runner. Shared
  dry-runs then reported 5 draft and 7 revision changes with
  `No changes were committed`.
- The real tag runs finished in one batch each. Component status reported
  `success`, `isDone: true`, processed 5 drafts and 7 revisions.
- The first post-tag audit correctly stopped on seven old Identity snapshots
  without `assets`. No payload row changed. PR #124 added the explicit
  version-1 rule: add only `identity.assets: {}` in the migrated view and keep
  platform-filled asset paths optional in owner storage.
- The final six-page audit scanned 5 drafts, 7 revisions and 78 section rows.
  It found zero missing or unknown versions, broken parents, duplicate
  sections, non-boolean Exports values or migration-validation failures. Five
  header-only setup revisions were counted separately. Eight old Features
  fields remain in two version-1 drafts and two version-1 complete revisions;
  the `1 -> 2` chain removes them without mutating frozen history.
- `npm run logs:convex` showed no matching failure during the final upload and
  audit. Deploy A passes. Deploy B may start.

### Deploy B: teach and migrate

1. Require `1 | 2` on draft and revision headers. New writes use version 2.
2. Route every payload-interpreting application boundary through the shared
   snapshot seam. An unsupported or missing version now fails closed.
3. Add `migrations/ownerConfiguration:migrateDraftsToV2` with its Convex data
   test now that the widened validator accepts version 2.
4. Upload from `dev-self`, rerun the audit, and prove old data can still be
   read through the explicit chain.
5. Migrate mutable drafts to version 2 in one transaction per draft without
   changing `editVersion`. Configure the migration component with one draft per
   batch if that is required to keep header and section writes atomic.
6. Keep historical revision payloads at their recorded versions.
7. Verify zero missing-version drafts or revisions and a clean audit of every
   historical revision through the full chain. Version-1 active revisions are
   valid until their next real operation creates a current candidate.
8. Replace the failed `new lib` version-1 update with one new version-2
   candidate operation. Keep the old failed operation as immutable history.

### Deploy C: narrow

1. Restrict mutable drafts to version 2. Revisions keep `1 | 2` because frozen
   version-1 history remains restorable.
2. Delete version-1 draft writes, optional header handling, metadata-backfill
   definitions and any transition-only code.
3. Keep the `1 -> 2` snapshot migration so Restore remains valid.
4. Run the full checks and shared live gate again.

## Deployability gate

For each implementation lane:

- run the focused Vitest files and `npx tsc --noEmit`;
- run `npx convex dev --once` only against that lane's Convex Cloud deployment;
- run the audit and migration dry-run against a production snapshot copy;
- use the browser for the configuration and Versions flows;
- run one Fable-5 review after the complete phase.

For shared production, only from `dev-self`:

1. Confirm no other Convex uploader is running. Export the data snapshot.
2. Run `npm run convex:push` for Deploy A and require
   `Convex functions ready!`.
3. Keep `npm run logs:convex` open. Run every audit page, dry-run and version-1
   metadata backfill. Rerun every audit page after tagging. Verify zero missing
   headers and zero migration-validation failures, and record the exact counts.
4. Merge lanes R and E only after step 3. Run `npm run convex:push` for Deploy B,
   migrate drafts, verify migration status and rerun every audit page.
5. Prove a failed current candidate leaves its old library and health answer
   unchanged, then Retry and confirm it reuses the candidate. Prove the old
   failed `new lib` version-1 operation has no Retry action.
6. Start a fresh `new lib` Update to `937bb65e`. Confirm it migrates revision
   `r2` into one version-2 candidate, its platform address stays healthy
   throughout, and health reports the candidate only after readiness.
7. Restore `new lib` from its version-1 historical revision. Confirm a new
   version-2 revision deploys and the source payload is unchanged.
8. Prove address and custom-domain publishes use current candidates. Use a
   uniquely named throwaway library and remove it through the app afterward.
9. Verify zero missing versions and zero unexplained failed migration
   operations. Version-1 historical and still-active revisions remain
   supported by the explicit chain. Commit and push Deploy C, then repeat the
   audit and health checks.

## Completion rules

- Every draft and revision has an explicit known version.
- The migration registry has a complete consecutive path from every supported
  historical version to current.
- Every configuration read that interprets section payloads uses the shared
  snapshot seam.
- New writes are strict and current. Historical revisions remain unchanged.
- Live pointers change only after a migrated candidate passes readiness.
- Retry reuses the same candidate and never repeats a transformation.
- Unknown, ambiguous, invalid or secret-bearing data blocks the release with
  safe issues.
- The production audit, dry runs, migrations, status checks, Deploy A, Deploy B,
  Deploy C, browser flows, logs and health checks all pass.
- The final pushed commit and proof are recorded in this plan and read back
  from Outline.

## What this system does not do

- It does not infer migration meaning from a schema diff.
- It does not silently coerce types, choose between conflicting fields or drop
  unknown data.
- It does not mutate frozen revision payloads. Address and domain changes put
  the new address in a fresh candidate and update only mutable binding, draft
  and domain state after readiness.
- It does not put migration logic in the Coolify action.
- It does not expose a user repair screen for platform-caused changes.
- It does not build a migration language. Each version change is ordinary,
  explicit TypeScript over one full snapshot.

## Planning review

Fable-5 reviewed this corrected planning phase once on 2026-08-29. It found
unsafe Deploy A ordering, incomplete migrated-row persistence, an unnecessary
unauthenticated mass live rollout, a retry idempotency gap, the older Exports
shape, incomplete-draft validation, and existing address writes to frozen
revisions. This revision fixes those findings. Per the user's review rule, it
was not sent through another planning pass.

## Sources

- Convex database migration guidance:
  https://docs.convex.dev/database/writing-data#migrations
- Convex stateful migrations component:
  https://github.com/get-convex/migrations
- Repository migration skill and references:
  `.agents/skills/convex-migration-helper/`.
- Current snapshot and deployment code named above, checked on `dev` at
  `65aa588c`.
