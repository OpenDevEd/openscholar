# Plan 18 — Safe stored configuration upgrades

## Goal

Fix the update failure on `new lib`, make deterministic configuration errors
useful, and set the rule that prevents the same mistake after production data
exists.

This plan does not add a compatibility reader or migration framework. The
current database is development data. We clean its stale rows through the
normal Save and Activate flow, while keeping old frozen revisions as history.

## What failed on 2026-08-29

`new lib` was healthy on runtime `95ac3fc0`. Its update to `937bb65e` failed
before Coolify ran. Active revision `r2` still stores:

- `/features/aiSearch`
- `/features/deepResearch`

Plan 15 made those values platform-owned. New owner writes correctly reject
them. The old active revision therefore fails current validation before an
update can start. Retry repeats the same revision and the same failure.

## Facts checked

- `rowPayload` in `lib/evidence-libraries/configuration/rules.ts` removes both
  fields from every new Features save.
- `changedSectionRows` compares the cleaned form of both the old and new row.
  It therefore calls an unchanged stale row clean and never rewrites it.
- The repository already handles the same problem for old export rows with
  `staleExportsRow` in `rules.ts`.
- Git history shows that only `features.aiSearch` and
  `features.deepResearch` were previously written and later moved to platform
  ownership. OpenScholar did not save `search.embedder`, provider
  `largeModel`/`smallModel`, or `email.smtp`.
- Runtime assembly already derives `aiSearch`, `deepResearch` and the search
  embedder. Removing the two stale owner values changes no live behavior.
- Draft and revision rows are development data, but old revisions are still
  useful history. A clean new revision can replace `r2` as active without
  rewriting `r2`.
- `prepareConfigurationDeployment` drops validation details when it throws a
  generic Convex error. The existing operation banner offers Retry for every
  failed operation even when a retry cannot change the result.

## Decisions

1. **Keep owner validation strict.** New browser and API writes carrying
   platform-owned fields remain errors.
2. **Do not add a read-time converter.** It would be a permanent compatibility
   path for disposable development data. Do not add an owner-format version,
   migration registry, fallback, cron or queue.
3. **Make the existing Save path notice the stale row.** Add a
   `stalePlatformFeaturesRow` check beside `staleExportsRow`.
   `changedSectionRows` then returns a clean Features payload even when the
   visible switches did not change. Save replaces the draft row; Activate
   creates a clean revision through the existing path.
4. **Clean current development data through the app.** First list every stale
   draft and revision with a read-only Convex data check. Delete throwaway
   libraries. For any library worth keeping, Save and Activate its
   automatically dirty Features section, then update it. Do not edit a frozen
   revision in place.
5. **Do not offer Retry for deterministic configuration errors.** Pass safe
   issue pointers and messages through the existing Convex error data. Reuse
   `sanitizeConfigurationIssues`. The existing issue links take the owner to
   the matching setting. Hide Retry when the operation has configuration
   issues; keep it for network, Coolify and readiness failures.
6. **Production rule.** Once production configuration data exists, a change to
   stored ownership or meaning must include a read-only audit and a real,
   explicit data migration before the stricter validator is deployed. If the
   old value has no unambiguous new meaning, stop the release and get a product
   decision. Never make owners repair a platform ownership change.

## Existing code to reuse

- `rowPayload`, `changedSectionRows` and `staleExportsRow` in
  `lib/evidence-libraries/configuration/rules.ts`.
- Owner validation in `owner-rules.ts`; it stays unchanged.
- `createError` extra data in `convex/lib/errors.ts`.
- `sanitizeConfigurationIssues` in
  `convex/evidenceLibraries/operations.ts`.
- Deployment failure storage in
  `convex/evidenceLibraries/configurationDeployment.ts` and
  `configurationDeploymentActions.ts`.
- The existing issue list and jump links in
  `components/evidence-libraries/configuration/configuration-workspace.tsx`.

## Work shape

This is one implementation lane. The pure stale-row check and its small error
path share one invariant and do not justify several write lanes. GPT-5.6 Luna
Max agents can map callers and fixtures in parallel without editing. The lane
works in its own worktree and Convex Cloud deployment. The integration owner
alone merges and uploads `dev` to the shared deployment.

Every agent reads `ponytail` and `unslop`. Fable-5 reviews once at the end of
each complete implementation phase, not after each commit.

## Test decision

Tests are required because this changes saved-data behavior and operation
recovery behavior.

- `lib/evidence-libraries/configuration/rules.test.ts`: an unchanged saved
  Features row containing the two old keys is dirty and produces one clean
  Features write; a current row stays clean.
- `convex/evidenceLibraries/configurationDeployment.test.ts`: validation
  issues from preparation reach the failed public operation with safe pointers
  and messages.
- `tests/components/evidence-library-configuration-workspace.test.tsx`: a
  failed operation with issues lists them and has no Retry action; a transient
  failed operation still has Retry. Test roles, links and behavior, not classes
  or incidental copy.
- No activation, restore or address tests are needed because those paths do not
  change. Their input becomes clean through the existing Save and Activate
  flow.

## Phase 1 — Clean stale development rows through Save

1. Add the failing `rules.test.ts` cases.
2. Add the smallest `stalePlatformFeaturesRow` check next to
   `staleExportsRow`. It checks only `aiSearch` and `deepResearch` on the raw
   saved Features payload.
3. Run the focused test and TypeScript. In the lane browser, load an old-format
   fixture and confirm the page is dirty without toggling a switch, Save writes
   a clean row, and Activate creates a clean revision.
4. Run one Fable-5 review of the complete phase.

## Phase 2 — Show the real error and the right recovery

1. Add a failing deployment test for issue preservation. In
   `prepareConfigurationDeployment`, pass the validation issues through
   `createError` extra data after reducing them to pointer and message.
2. In `configurationDeploymentActions.ts`, handle a `ConvexError` whose data
   contains issues and pass those issues through the existing sanitizer. Do
   not add another error class or an operation field.
3. Add the banner behavior tests. Hide Retry when `operation.issues` is not
   empty. Keep the existing issue links and keep Retry for transient failures.
4. Read the matching installed Next.js guide, run focused tests, TypeScript,
   the lane Convex upload, and the browser check.
5. Run one Fable-5 review of the complete phase.

## Current development cleanup

After Phase 1 is merged and uploaded:

1. Run this read-only check from `dev-self` and record its exact rows and count
   in this plan:

   ```sh
   npx convex data evidenceLibraryConfigSections --limit 10000 --format json |
     jq '[.[] | select(.sectionKey == "features" and ((.payload | has("aiSearch")) or (.payload | has("deepResearch")))) | {id: ._id, libraryId, kind, draftId, revisionId}]'
   ```
2. Delete throwaway libraries through the app and confirm their Coolify apps
   are gone.
3. For each library being kept, open configuration, Save the automatically
   dirty Features section, and Activate. Confirm the new draft and revision do
   not contain either old key.
4. On `new lib`, Update to `937bb65e` from the new clean active revision. Do
   not Retry the old failed operation because it is correctly tied to `r2`.

## Deployability gate

1. In the lane, run `npx tsc --noEmit`, the focused Vitest files and
   `npx convex dev --once`.
2. In the lane browser, prove the old Features row becomes dirty, saves cleanly
   and activates. Inject one deterministic validation failure and prove its
   issue link is shown without Retry. Prove a transient failure still has
   Retry.
3. After merge, the integration owner runs `npm run convex:push` from
   `dev-self` and sees `Convex functions ready!`. Keep `npm run logs:convex`
   open during the shared check.
4. Complete the current development cleanup above. For `new lib`, confirm
   Update reaches `937bb65e` and
   `/api/library-config/health` returns the new active revision.
5. Repeat Save, Activate and Update on one uniquely named throwaway library.
   Delete it through the app and confirm its Coolify app is gone.

## Completion rules

- New writes with platform-owned fields still fail validation.
- An old Features draft becomes dirty and Save removes exactly the two stale
  keys.
- No permanent converter, version registry, fallback or migration code exists.
- Deterministic configuration failures show safe issues and no Retry.
- Transient failures still offer Retry.
- All stale development libraries are either deleted or activated on a clean
  revision.
- `new lib` runs `937bb65e`; focused tests, TypeScript, lane upload, shared
  upload, logs, browser checks and health check all pass.
- The merged and verified result is recorded in this plan and read back from
  the smallest matching Outline current-state page.

## Known risks

- Checking the normalized draft instead of the raw stored row would recreate
  the bug. The stale-row helper reads the raw payload.
- Removing any field except the two proven historical keys could hide bad or
  secret data. Every other unexpected field remains an error.
- Hiding Retry for every failure would block recovery from real temporary
  outages. The banner uses the presence of configuration issues, not the broad
  failed status.
- Saving without Activating leaves the old active revision in place. The
  cleanup gate requires both actions before Update.

## Planning review

Fable-5 reviewed this planning phase once on 2026-08-29. It rejected the first
draft's permanent read-time converter as a compatibility path, proved that only
the two Features keys were historically stored, and identified the existing
Convex error-data and stale-row seams reused above. This plan includes those
findings. It was not sent through a second planning review.
